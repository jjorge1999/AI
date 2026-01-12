import { Injectable } from '@angular/core';
import { Reservation, Sale } from '../models/inventory.models';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { FirebaseService } from './firebase.service';
import { collection, doc, getDoc, writeBatch } from 'firebase/firestore';

@Injectable({
  providedIn: 'root',
})
export class ReservationService {
  private get db() {
    return this.firebaseService.db;
  }

  constructor(private firebaseService: FirebaseService) {}

  addReservation(reservation: Omit<Reservation, 'id'>): Observable<string> {
    // Generate a unique Order ID to group items
    const orderId =
      'RES-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const timestamp = new Date();
    const deliveryDate = reservation.pickupDate
      ? new Date(reservation.pickupDate as any)
      : null;

    const deliveryNotes = `RESERVATION: ${reservation.customerName} (${
      reservation.customerContact
    }).\n${reservation.notes || ''}. Address: ${
      reservation.customerAddress || 'N/A'
    }`;

    // Process reservation items and create sales documents
    return from(
      this.processReservationItems(
        reservation,
        orderId,
        timestamp,
        deliveryDate,
        deliveryNotes
      )
    ).pipe(
      map(() => orderId),
      catchError((err) => {
        console.error('Error submitting reservation:', err);
        throw err;
      })
    );
  }

  private async processReservationItems(
    reservation: Omit<Reservation, 'id'>,
    orderId: string,
    timestamp: Date,
    deliveryDate: Date | null,
    deliveryNotes: string
  ): Promise<void> {
    const batch = writeBatch(this.db);
    const salesCollection = collection(this.db, 'sales');
    const productsCollection = collection(this.db, 'products');

    // Loop through items and create a Sale document for each
    for (const item of reservation.items) {
      const saleRef = doc(salesCollection);

      // Fetch the product to get its userId (owner)
      let productUserId = 'guest';
      let productStoreId = reservation.storeId || null;

      try {
        const productDocRef = doc(productsCollection, item.productId);
        const productDoc = await getDoc(productDocRef);
        if (productDoc.exists()) {
          const productData = productDoc.data();
          if (productData && productData['userId']) {
            productUserId = productData['userId'];
          }
          if (productData && productData['storeId']) {
            productStoreId = productData['storeId'];
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
        customerId: reservation.customerName.toLowerCase().trim(),
        customerName: reservation.customerName,
        customerContact: reservation.customerContact,
        customerAddress: reservation.customerAddress || '',
        pending: true,
        reservationStatus: 'pending_confirmation',
        userId: productUserId,
        storeId: productStoreId,
        orderId: orderId,
      };

      batch.set(saleRef, saleData);
    }

    await batch.commit();
    // console.log('Reservation submitted successfully:', orderId);
  }
}
