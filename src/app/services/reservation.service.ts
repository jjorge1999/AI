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
    // Send the entire reservation object to the backend.
    // The backend will handle batching items into sales records.
    await firstValueFrom(
      this.http.post(`${this.apiUrl}/reservations`, reservation)
    );

    return 'reservation-submitted';
  }
}
