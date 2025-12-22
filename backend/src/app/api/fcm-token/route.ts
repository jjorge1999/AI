import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';
import * as admin from 'firebase-admin';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const { userId, token } = await request.json();

    if (!userId || !token) {
      return withCors(
        NextResponse.json(
          { error: 'userId and token are required' },
          { status: 400 }
        ),
        origin
      );
    }

    // Update user document with the token, using arrayUnion to avoid duplicates
    const userSnapshot = await db
      .collection('users')
      .where('id', '==', userId)
      .get();

    if (userSnapshot.empty) {
      // If user doc with custom ID doesn't exist, try document ID
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        // Fallback: Store in a separate collection if user not found
        await db.collection('fcm_tokens').add({
          userId,
          token,
          updatedAt: new Date(),
        });
      } else {
        await userRef.update({
          fcmTokens: admin.firestore.FieldValue.arrayUnion(token),
        });
      }
    } else {
      const userRef = userSnapshot.docs[0].ref;
      await userRef.update({
        fcmTokens: admin.firestore.FieldValue.arrayUnion(token),
      });
    }

    return withCors(NextResponse.json({ success: true }), origin);
  } catch (error) {
    console.error('Error saving FCM token:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to save token' }, { status: 500 }),
      origin
    );
  }
}
