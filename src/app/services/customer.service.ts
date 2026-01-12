import { Injectable, signal, WritableSignal, computed } from '@angular/core';
import { BehaviorSubject, Observable, of, throwError, from } from 'rxjs';
import { map, tap, catchError, take, finalize } from 'rxjs/operators';
import { Customer } from '../models/inventory.models';
import { StoreService } from './store.service';
import { FirebaseService } from './firebase.service';
import { LoadingService } from './loading.service';
import { IndexedDbService } from './indexed-db.service';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  setDoc,
} from 'firebase/firestore';

@Injectable({
  providedIn: 'root',
})
export class CustomerService {
  // High performance state management using Signals
  private readonly _customers: WritableSignal<Customer[]> = signal([]);
  public readonly customers = this._customers.asReadonly();

  private customersSubject = new BehaviorSubject<Customer[]>([]);
  public customers$ = this.customersSubject.asObservable();

  private get db() {
    return this.firebaseService.db;
  }

  constructor(
    private firebaseService: FirebaseService,
    private storeService: StoreService,
    private indexedDbService: IndexedDbService,
    private loadingService: LoadingService
  ) {
    this.hydrateFromCache();

    // Automatically reload customers when the active store changes
    this.storeService.activeStoreId$.subscribe((storeId) => {
      if (storeId) {
        this.loadCustomers(true); // Force reload for new store
      } else {
        this._customers.set([]);
        this.customersSubject.next([]);
      }
    });
  }

  private hydrateFromCache(): void {
    this.indexedDbService
      .get('jjm_cached_customers')
      .pipe(take(1))
      .subscribe({
        next: (cached) => {
          if (cached) {
            try {
              this._customers.set(cached);
              this.customersSubject.next(cached);
              console.log('Hydrated Customers from IndexedDB');
            } catch (e) {
              console.warn('Failed to parse cached customers', e);
            }
          }
        },
        error: (err) =>
          console.warn('Failed to hydrate customers from IndexedDB', err),
      });
  }

  private saveToCache(customers: Customer[]): void {
    this.indexedDbService
      .set('jjm_cached_customers', customers)
      .pipe(take(1))
      .subscribe({
        error: (err) => console.error('Failed to save customers to cache', err),
      });
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
    const storeId = this.storeService.getActiveStoreId();

    // Security: Fetch customers only if we have a store context.
    // Auth security is handled by Firestore Rules.
    if (!storeId) {
      console.log('CustomerService: No storeId, clearing customers.');
      this._customers.set([]);
      this.customersSubject.next([]);
      return;
    }

    console.log('CustomerService: Fetching customers for storeId:', storeId);

    const customersRef = collection(this.db, 'customers');
    const q = query(customersRef, where('storeId', '==', storeId));

    from(getDocs(q)).subscribe({
      next: (snapshot) => {
        const customers: Customer[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as Customer[];
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
   * Uses client-side filtering to prevent exposing the entire database.
   */
  getCustomerByName(name: string): Observable<Customer[]> {
    const storeId = this.storeService.getActiveStoreId();
    if (!storeId) return of([]);

    // Query all customers for the store and filter by name client-side
    const customersRef = collection(this.db, 'customers');
    const q = query(customersRef, where('storeId', '==', storeId));

    return from(getDocs(q)).pipe(
      map((snapshot) => {
        const allCustomers = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as Customer[];

        // Filter by name (case-insensitive)
        const filtered = allCustomers.filter((c) =>
          c.name?.toLowerCase().includes(name.toLowerCase())
        );

        // Mask sensitive data
        return filtered.map((c) => ({
          ...c,
          phoneNumber: c.phoneNumber,
          deliveryAddress: '***',
          gpsCoordinates: '***',
          userId: '***',
        }));
      })
    );
  }

  getCustomerByPhone(phone: string): Observable<Customer[]> {
    const storeId = this.storeService.getActiveStoreId();
    if (!storeId) return of([]);

    const customersRef = collection(this.db, 'customers');
    const q = query(
      customersRef,
      where('storeId', '==', storeId),
      where('phoneNumber', '==', phone)
    );

    return from(getDocs(q)).pipe(
      map(
        (snapshot) =>
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          })) as Customer[]
      )
    );
  }

  addCustomer(
    customer: Omit<Customer, 'id' | 'createdAt'>
  ): Observable<Customer> {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId && !customer.storeId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    const targetStoreId = this.enforceStoreId(
      activeStoreId || customer.storeId || ''
    );

    const id = crypto.randomUUID();
    const newCustomer: Customer = {
      ...customer,
      id,
      userId: this.getCurrentUser(),
      storeId: targetStoreId,
      createdAt: new Date(),
    } as Customer;

    const sanitized = this.sanitizeData(newCustomer);

    const docRef = doc(this.db, 'customers', id);
    this.loadingService.show('Adding customer...');
    return from(setDoc(docRef, sanitized)).pipe(
      map(() => sanitized),
      tap((created) => {
        const current = this._customers();
        const updated = [...current, created];
        this._customers.set(updated);
        this.customersSubject.next(updated);
        this.saveToCache(updated);
      }),
      catchError((err) => {
        console.error('Error adding customer:', err);
        return throwError(() => err);
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  updateCustomer(id: string, updates: Partial<Customer>): Observable<Customer> {
    const payload = this.sanitizeData({ ...updates });
    if (payload.storeId) {
      payload.storeId = this.enforceStoreId(payload.storeId);
    }

    const docRef = doc(this.db, 'customers', id);
    this.loadingService.show('Updating customer...');
    return from(updateDoc(docRef, payload)).pipe(
      map(() => {
        const current = this._customers();
        const existing = current.find((c) => c.id === id);
        return { ...existing, ...updates } as Customer;
      }),
      tap((updated) => {
        const current = this._customers();
        const updatedList = current.map((c) =>
          c.id === id ? { ...c, ...updates } : c
        );
        this._customers.set(updatedList);
        this.customersSubject.next(updatedList);
        this.saveToCache(updatedList);
      }),
      catchError((err) => {
        console.error('Error updating customer:', err);
        return throwError(() => err);
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  deleteCustomer(id: string): Observable<void> {
    const docRef = doc(this.db, 'customers', id);
    this.loadingService.show('Deleting customer...');
    return from(deleteDoc(docRef)).pipe(
      tap(() => {
        const current = this._customers();
        const filtered = current.filter((c) => c.id !== id);
        this._customers.set(filtered);
        this.customersSubject.next(filtered);
        this.saveToCache(filtered);
      }),
      catchError((err) => {
        console.error('Error deleting customer:', err);
        return throwError(() => err);
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  getCustomerById(id: string): Customer | undefined {
    return this.customersSubject.value.find((c) => c.id === id);
  }

  private enforceStoreId(requestedId?: string): string | undefined {
    const role = localStorage.getItem('jjm_role');
    const userStoreId = localStorage.getItem('jjm_store_id');

    // Super Admin can set any store
    if (role === 'super-admin') {
      return requestedId;
    }

    // Public/Guest users (not logged in) - use the requested storeId from the form
    if (!role) {
      return requestedId;
    }

    // Admins and others are restricted to their own store
    return userStoreId || requestedId;
  }

  private sanitizeData(data: any): any {
    if (data === null || typeof data !== 'object') {
      return data;
    }

    if (data instanceof Date) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((v) => this.sanitizeData(v));
    }

    const result: any = {};
    Object.keys(data).forEach((key) => {
      const value = data[key];
      if (value !== undefined) {
        result[key] = this.sanitizeData(value);
      }
    });

    return result;
  }
}
