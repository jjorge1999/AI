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
    const reservation = await request.json();

    // Generate a unique Order ID to group items
    const orderId =
      'RES-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const batch = db.batch();
    const salesCollection = db.collection('sales');
    const productsCollection = db.collection('products');
    const timestamp = new Date();
    const deliveryDate = reservation.pickupDate
      ? new Date(reservation.pickupDate)
      : null;

    const deliveryNotes = `RESERVATION: ${reservation.customerName} (${
      reservation.customerContact
    }).\n${reservation.notes || ''}. Address: ${
      reservation.customerAddress || 'N/A'
    }`;

    // Loop through items and create a Sale document for each
    for (const item of reservation.items) {
      const saleRef = salesCollection.doc();

      // Fetch the product to get its userId (owner)
      let productUserId = 'guest'; // Default fallback
      try {
        const productDoc = await productsCollection.doc(item.productId).get();
        if (productDoc.exists) {
          const productData = productDoc.data();
          if (productData && productData.userId) {
            productUserId = productData.userId;
          }
        }
      } catch (e) {
        console.warn(`Could not fetch product ${item.productId}:`, e);
      }

      const saleData = {
        productId: item.productId,
        productName: item.productName,
        category: 'Reservation',
        price: item.price,
        quantitySold: item.quantity,
        total: item.price * item.quantity,
        cashReceived: 0,
        change: 0,
        timestamp: timestamp,
        deliveryDate: deliveryDate,
        deliveryNotes: deliveryNotes,
        // Store customer info for AI matching
        customerId: reservation.customerName.toLowerCase().trim(), // Use name as ID for matching
        customerName: reservation.customerName,
        customerContact: reservation.customerContact,
        customerAddress: reservation.customerAddress || '',
        pending: true,
        reservationStatus: 'pending_confirmation',
        userId: productUserId, // Use product owner's userId
        orderId: orderId,
      };

      batch.set(saleRef, saleData);
    }

    await batch.commit();

    // Send FCM Notifications to product owners
    try {
      // Better logic: Notify admins and the specific owner if found
      const usersSnapshot = await db.collection('users').get();
      const tokens: string[] = [];

      usersSnapshot.forEach((doc) => {
        const userData = doc.data();
        if (userData.fcmTokens && Array.isArray(userData.fcmTokens)) {
          // Notify admins of any new reservation, and owners of their specific products
          // (For now, we notify all staff/admin to ensure no one misses it)
          tokens.push(...userData.fcmTokens);
        }
      });

      const uniqueTokens = Array.from(new Set(tokens));

      if (uniqueTokens.length > 0) {
        const messagePayload = {
          notification: {
            title: 'New Reservation Received! 📦',
            body: `${reservation.customerName} has reserved ${reservation.items.length} item(s).`,
          },
          data: {
            type: 'new_reservation',
            customerName: reservation.customerName,
            orderId: orderId,
          },
          tokens: uniqueTokens,
        };

        const response = await admin
          .messaging()
          .sendEachForMulticast(messagePayload);
        console.log(
          `Successfully sent ${response.successCount} FCM messages for new reservation`
        );
      }
    } catch (fcmError) {
      console.error(
        'Failed to send FCM notifications for reservation:',
        fcmError
      );
    }

    return withCors(
      NextResponse.json(
        { message: 'Reservation submitted successfully', orderId },
        { status: 201 }
      ),
      origin
    );
  } catch (error) {
    console.error('Error submitting reservation:', error);
    return withCors(
      NextResponse.json(
        { error: 'Failed to submit reservation' },
        { status: 500 }
      ),
      origin
    );
  }
}
