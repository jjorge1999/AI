import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Customer } from '../models/inventory.models';
import { environment } from '../../environments/environment';
import { StoreService } from './store.service';

@Injectable({
  providedIn: 'root',
})
export class CustomerService {
  private apiUrl = environment.apiUrl;
  private customersSubject = new BehaviorSubject<Customer[]>([]);
  public customers$ = this.customersSubject.asObservable();

  constructor(private http: HttpClient, private storeService: StoreService) {
    // Manual loading only
  }

  public loadCustomers(): void {
    this.fetchCustomers();
  }

  private loadInitialData(): void {
    this.fetchCustomers();
  }

  private getCurrentUser(): string {
    return localStorage.getItem('jjm_user_id') || 'guest';
  }

  public reloadData(): void {
    this.loadInitialData();
  }

  private fetchCustomers(): void {
    const userId = this.getCurrentUser();
    const storeId = this.storeService.getActiveStoreId();

    // Security: Do not fetch customers for unauthenticated users or without store context
    if (!userId || userId === 'guest' || !storeId) {
      if (!storeId) this.customersSubject.next([]);
      return;
    }

    const url = `${this.apiUrl}/customers?userId=${userId}&storeId=${storeId}`;

    this.http.get<Customer[]>(url).subscribe({
      next: (customers) => this.customersSubject.next(customers),
      error: (err) => console.error('Error fetching customers:', err),
    });
  }

  getCustomers(): Observable<Customer[]> {
    return this.customers$;
  }

  /**
   * Fetches specific customer by name for verification.
   * Uses server-side filtering to prevent exposing the entire database.
   */
  getCustomerByName(name: string): Observable<Customer[]> {
    const storeId = this.storeService.getActiveStoreId();
    if (!storeId) return of([]);

    return this.http
      .get<Customer[]>(
        `${this.apiUrl}/customers?name=${encodeURIComponent(
          name
        )}&storeId=${storeId}`
      )
      .pipe(
        map((customers) =>
          customers.map((c) => ({
            ...c,
            // Explicitly mask sensitive data
            phoneNumber: c.phoneNumber, // Unmasked for verification
            deliveryAddress: '***',
            gpsCoordinates: '***',
            userId: '***', // Hide linked user ID if any
          }))
        )
      );
  }

  getCustomerByPhone(phone: string): Observable<Customer[]> {
    return this.http.get<Customer[]>(
      `${this.apiUrl}/customers?phoneNumber=${encodeURIComponent(phone)}`
    );
  }

  addCustomer(
    customer: Omit<Customer, 'id' | 'createdAt'>
  ): Observable<Customer> {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    const customerWithUser = {
      userId: this.getCurrentUser(),
      storeId: activeStoreId,
      ...customer,
    };
    return this.http
      .post<Customer>(`${this.apiUrl}/customers`, customerWithUser)
      .pipe(
        tap({
          next: (newCustomer) => {
            const current = this.customersSubject.value;
            this.customersSubject.next([...current, newCustomer]);
          },
          error: (err) => console.error('Error adding customer:', err),
        })
      );
  }

  updateCustomer(id: string, updates: Partial<Customer>): Observable<Customer> {
    return this.http
      .put<Customer>(`${this.apiUrl}/customers/${id}`, updates)
      .pipe(
        tap({
          next: () => {
            const current = this.customersSubject.value;
            const updated = current.map((c) =>
              c.id === id ? { ...c, ...updates } : c
            );
            this.customersSubject.next(updated);
          },
          error: (err) => console.error('Error updating customer:', err),
        })
      );
  }

  deleteCustomer(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/customers/${id}`).pipe(
      tap({
        next: () => {
          const current = this.customersSubject.value;
          const filtered = current.filter((c) => c.id !== id);
          this.customersSubject.next(filtered);
        },
        error: (err) => console.error('Error deleting customer:', err),
      })
    );
  }

  getCustomerById(id: string): Customer | undefined {
    return this.customersSubject.value.find((c) => c.id === id);
  }
}
