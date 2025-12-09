import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Reservation, Sale } from '../models/inventory.models';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class ReservationService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  addReservation(reservation: Omit<Reservation, 'id'>): Observable<string> {
    // Send the entire reservation object to the backend.
    // The backend will handle batching items into sales records.
    return this.http
      .post(`${this.apiUrl}/reservations`, reservation)
      .pipe(map(() => 'reservation-submitted'));
  }
}
