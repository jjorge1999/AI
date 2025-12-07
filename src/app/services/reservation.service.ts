import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Reservation, Sale } from '../models/inventory.models';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ReservationService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  async addReservation(reservation: Omit<Reservation, 'id'>): Promise<string> {
    // We will store reservations as 'Sales' with a special status in the system
    // This allows them to appear in the POS and be managed.
    // If a dedicated 'reservations' collection is needed later, an API endpoint should be created.

    const promises = reservation.items.map((item) => {
      const saleData: any = {
        productId: item.productId,
        productName: item.productName,
        category: 'Reservation',
        price: item.price,
        quantitySold: item.quantity,
        total: item.price * item.quantity,
        cashReceived: 0,
        change: 0,
        timestamp: new Date().toISOString(), // Use ISO string for API
        deliveryDate: reservation.pickupDate.toISOString(), // Use ISO string
        deliveryNotes: `RESERVATION: ${reservation.customerName} (${
          reservation.customerContact
        }).\n${reservation.notes || ''}. Address: ${
          reservation.customerAddress || 'N/A'
        }`,
        customerId: '',
        pending: true,
        reservationStatus: 'pending_confirmation',
        userId: 'guest', // Mark as guest/public
      };

      return firstValueFrom(
        this.http.post<Sale>(`${this.apiUrl}/sales`, saleData)
      );
    });

    await Promise.all(promises);

    return 'reservation-submitted';
  }
}
