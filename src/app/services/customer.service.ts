import { Injectable, signal, WritableSignal, computed } from '@angular/core';
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

  // High performance state management using Signals
  private readonly _customers: WritableSignal<Customer[]> = signal([]);
  public readonly customers = this._customers.asReadonly();

  private customersSubject = new BehaviorSubject<Customer[]>([]);
  public customers$ = this.customersSubject.asObservable();

  constructor(private http: HttpClient, private storeService: StoreService) {
    this.hydrateFromCache();
  }

  private hydrateFromCache(): void {
    const cached = localStorage.getItem('jjm_cached_customers');
    if (cached) {
      try {
        const customers = JSON.parse(cached);
        this._customers.set(customers);
        this.customersSubject.next(customers);
        console.log('Hydrated Customers from cache');
      } catch (e) {
        console.warn('Failed to hydrate customers from cache', e);
      }
    }
  }

  private saveToCache(customers: Customer[]): void {
    localStorage.setItem('jjm_cached_customers', JSON.stringify(customers));
  }

  public loadCustomers(force = false): void {
    // Check if data exists before calling fetch (Optimization)
    if (!force && this._customers().length > 0) {
      console.log('Customers already loaded in Signal. Skipping fetch.');
      return;
    }
    this.fetchCustomers();
  }

  private loadInitialData(): void {
    this.loadCustomers();
  }

  private getCurrentUser(): string {
    return localStorage.getItem('jjm_user_id') || 'guest';
  }

  public reloadData(): void {
    this.loadCustomers(true);
  }

  private fetchCustomers(): void {
    const userId = this.getCurrentUser();
    const storeId = this.storeService.getActiveStoreId();

    // Security: Do not fetch customers for unauthenticated users or without store context
    if (!userId || userId === 'guest' || !storeId) {
      if (!storeId) {
        this._customers.set([]);
        this.customersSubject.next([]);
      }
      return;
    }

    const url = `${this.apiUrl}/customers?userId=${userId}&storeId=${storeId}`;

    this.http.get<Customer[]>(url).subscribe({
      next: (customers) => {
        this._customers.set(customers);
        this.customersSubject.next(customers);
        this.saveToCache(customers);
      },
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
            const current = this._customers();
            const updated = [...current, newCustomer];
            this._customers.set(updated);
            this.customersSubject.next(updated);
            this.saveToCache(updated);
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
            const current = this._customers();
            const updated = current.map((c) =>
              c.id === id ? { ...c, ...updates } : c
            );
            this._customers.set(updated);
            this.customersSubject.next(updated);
            this.saveToCache(updated);
          },
          error: (err) => console.error('Error updating customer:', err),
        })
      );
  }

  deleteCustomer(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/customers/${id}`).pipe(
      tap({
        next: () => {
          const current = this._customers();
          const filtered = current.filter((c) => c.id !== id);
          this._customers.set(filtered);
          this.customersSubject.next(filtered);
          this.saveToCache(filtered);
        },
        error: (err) => console.error('Error deleting customer:', err),
      })
    );
  }

  getCustomerById(id: string): Customer | undefined {
    return this.customersSubject.value.find((c) => c.id === id);
  }
}
