import { Injectable, signal, WritableSignal, computed } from '@angular/core';
import { BehaviorSubject, Observable, of, throwError, from } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';
import { Customer } from '../models/inventory.models';
import { StoreService } from './store.service';
import { FirebaseService } from './firebase.service';
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
    private storeService: StoreService
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
      customer.storeId || activeStoreId || ''
    );

    const id = crypto.randomUUID();
    const newCustomer: Customer = {
      ...customer,
      id,
      userId: this.getCurrentUser(),
      storeId: targetStoreId,
      createdAt: new Date(),
    } as Customer;

    const docRef = doc(this.db, 'customers', id);
    return from(setDoc(docRef, newCustomer)).pipe(
      map(() => newCustomer),
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
      })
    );
  }

  updateCustomer(id: string, updates: Partial<Customer>): Observable<Customer> {
    const payload = { ...updates };
    if (payload.storeId) {
      payload.storeId = this.enforceStoreId(payload.storeId);
    }

    const docRef = doc(this.db, 'customers', id);
    return from(updateDoc(docRef, payload as Record<string, any>)).pipe(
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
      })
    );
  }

  deleteCustomer(id: string): Observable<void> {
    const docRef = doc(this.db, 'customers', id);
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
      })
    );
  }

  getCustomerById(id: string): Customer | undefined {
    return this.customersSubject.value.find((c) => c.id === id);
  }

  private enforceStoreId(requestedId?: string): string | undefined {
    const role = localStorage.getItem('jjm_role');
    const userStoreId = localStorage.getItem('jjm_store_id');

    if (role === 'super-admin') {
      return requestedId;
    }

    // Admins and others are restricted to their own store
    return userStoreId || undefined;
  }
}
