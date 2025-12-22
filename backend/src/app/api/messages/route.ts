import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';
import * as admin from 'firebase-admin';

const COLLECTION_NAME = 'messages';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .orderBy('timestamp', 'asc')
      .limit(100) // Get last 100 messages
      .get();

    const messages = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate
          ? data.timestamp.toDate()
          : data.timestamp,
      };
    });
    return withCors(NextResponse.json(messages), origin);
  } catch (error) {
    console.error('Error fetching messages:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 }),
      origin
    );
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const body = await request.json();

    const docRef = await db.collection(COLLECTION_NAME).add({
      text: body.text,
      senderName: body.senderName,
      timestamp: new Date(),
      userId: body.userId || null,
    });

    const newMessage = {
      id: docRef.id,
      ...body,
      timestamp: new Date(),
    };

    // Broadcast to WebSocket server
    const socketUrl = process.env.SOCKET_URL || 'http://localhost:3001';
    try {
      await fetch(`${socketUrl}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMessage),
      });
    } catch (wsError) {
      console.error('Failed to broadcast message:', wsError);
    }

    // Send FCM Notifications
    try {
      const usersSnapshot = await db.collection('users').get();
      const tokens: string[] = [];
      usersSnapshot.forEach((doc) => {
        const userData = doc.data();
        if (
          userData.id !== body.userId &&
          userData.fcmTokens &&
          Array.isArray(userData.fcmTokens)
        ) {
          tokens.push(...userData.fcmTokens);
        }
      });

      // Also check fcm_tokens collection for standalone tokens
      const extraTokensSnapshot = await db
        .collection('fcm_tokens')
        .where('userId', '!=', body.userId || '')
        .get();
      extraTokensSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.token) tokens.push(data.token);
      });

      const uniqueTokens = Array.from(new Set(tokens));

      if (uniqueTokens.length > 0) {
        const messagePayload = {
          notification: {
            title: `New message from ${body.senderName}`,
            body:
              body.text.length > 100
                ? body.text.substring(0, 97) + '...'
                : body.text,
          },
          data: {
            type: 'chat_message',
            senderName: body.senderName,
            messageId: docRef.id,
          },
          tokens: uniqueTokens,
        };

        const response = await admin
          .messaging()
          .sendEachForMulticast(messagePayload);
        console.log(`Successfully sent ${response.successCount} FCM messages`);
      }
    } catch (fcmError) {
      console.error('Failed to send FCM notifications:', fcmError);
    }

    return withCors(NextResponse.json(newMessage, { status: 201 }), origin);
  } catch (error) {
    console.error('Error adding message:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to add message' }, { status: 500 }),
      origin
    );
  }
}
