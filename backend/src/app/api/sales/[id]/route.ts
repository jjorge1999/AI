import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';
import * as admin from 'firebase-admin';

const COLLECTION_NAME = 'sales';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = request.headers.get('origin');
  try {
    const { id } = await params;
    const body = await request.json();

    // Get current sale data to see what changed
    const saleDoc = await db.collection(COLLECTION_NAME).doc(id).get();
    const oldData = saleDoc.data();

    await db.collection(COLLECTION_NAME).doc(id).update(body);

    // Notification Logic for Deliveries
    if (body.pending === false && oldData?.pending === true) {
      try {
        const usersSnapshot = await db.collection('users').get();
        const tokens: string[] = [];

        usersSnapshot.forEach((doc) => {
          const userData = doc.data();
          // Notify owner of the sale and admins
          if (
            (userData.id === oldData?.userId || userData.role === 'admin') &&
            userData.fcmTokens
          ) {
            tokens.push(...userData.fcmTokens);
          }
        });

        const uniqueTokens = Array.from(new Set(tokens));
        if (uniqueTokens.length > 0) {
          await admin.messaging().sendEachForMulticast({
            notification: {
              title: 'Delivery Confirmed! ✅',
              body: `The order for ${
                oldData?.customerName || 'a customer'
              } has been delivered.`,
            },
            data: {
              type: 'delivery_update',
              saleId: id,
              status: 'delivered',
            },
            tokens: uniqueTokens,
          });
        }
      } catch (fcmError) {
        console.error('Failed to send delivery notification:', fcmError);
      }
    }

    return withCors(NextResponse.json({ id, ...body }), origin);
  } catch (error) {
    console.error('Error updating sale:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to update sale' }, { status: 500 }),
      origin
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = request.headers.get('origin');
  try {
    const { id } = await params;
    await db.collection(COLLECTION_NAME).doc(id).delete();
    return withCors(NextResponse.json({ message: 'Sale deleted' }), origin);
  } catch (error) {
    console.error('Error deleting sale:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to delete sale' }, { status: 500 }),
      origin
    );
  }
}
