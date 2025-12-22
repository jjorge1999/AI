import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';
import * as admin from 'firebase-admin';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const dayAfter = new Date(today);
    dayAfter.setDate(today.getDate() + 2);

    // Fetch all pending sales with delivery dates
    const salesSnapshot = await db
      .collection('sales')
      .where('pending', '==', true)
      .get();

    const remindersSent = [];

    for (const doc of salesSnapshot.docs) {
      const sale = doc.data();
      if (!sale.deliveryDate) continue;

      const delivery = sale.deliveryDate.toDate
        ? sale.deliveryDate.toDate()
        : new Date(sale.deliveryDate);
      const deliveryDay = new Date(
        delivery.getFullYear(),
        delivery.getMonth(),
        delivery.getDate()
      );

      let title = '';
      let body = '';

      if (deliveryDay.getTime() === today.getTime()) {
        title = 'Delivery Due Today! 🚚';
        body = `The order for ${sale.customerName} is due today.`;
      } else if (deliveryDay.getTime() === tomorrow.getTime()) {
        title = 'Delivery Reminder 📦';
        body = `The order for ${sale.customerName} is due tomorrow.`;
      } else if (deliveryDay < today) {
        title = 'Overdue Delivery! 🚨';
        body = `The order for ${
          sale.customerName
        } was due on ${deliveryDay.toLocaleDateString()}.`;
      }

      if (title) {
        // Find users to notify (Owner + Admins)
        const tokens = await getNotificationTokens(sale.userId);

        if (tokens.length > 0) {
          await admin.messaging().sendEachForMulticast({
            notification: { title, body },
            data: {
              type: 'delivery_reminder',
              saleId: doc.id,
              customerName: sale.customerName,
            },
            tokens: tokens,
          });
          remindersSent.push({ saleId: doc.id, customer: sale.customerName });
        }
      }
    }

    return withCors(
      NextResponse.json({
        success: true,
        count: remindersSent.length,
        details: remindersSent,
      }),
      origin
    );
  } catch (error) {
    console.error('Error sending delivery reminders:', error);
    return withCors(
      NextResponse.json({ error: 'Internal Server Error' }, { status: 500 }),
      origin
    );
  }
}

async function getNotificationTokens(ownerId: string): Promise<string[]> {
  const tokens: string[] = [];
  const usersSnapshot = await db.collection('users').get();

  usersSnapshot.forEach((doc) => {
    const user = doc.data();
    // Notify owner or admins
    if ((user.id === ownerId || user.role === 'admin') && user.fcmTokens) {
      tokens.push(...user.fcmTokens);
    }
  });

  return Array.from(new Set(tokens));
}
