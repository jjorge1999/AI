import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function POST(request: Request) {
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
        customerId: '',
        pending: true,
        reservationStatus: 'pending_confirmation',
        userId: productUserId, // Use product owner's userId
        orderId: orderId,
      };

      batch.set(saleRef, saleData);
    }

    await batch.commit();

    return NextResponse.json(
      { message: 'Reservation submitted successfully', orderId },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error submitting reservation:', error);
    return NextResponse.json(
      { error: 'Failed to submit reservation' },
      { status: 500 }
    );
  }
}
