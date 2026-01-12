import { Injectable, signal, WritableSignal, computed } from '@angular/core';
import { BehaviorSubject, Observable, from, of, throwError } from 'rxjs';
import { map, tap, catchError, take, finalize } from 'rxjs/operators';
import { Store } from '../models/inventory.models';
import { FirebaseService } from './firebase.service';
import { IndexedDbService } from './indexed-db.service';
import { LoadingService } from './loading.service';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  setDoc,
} from 'firebase/firestore';

@Injectable({
  providedIn: 'root',
})
export class StoreService {
  // High performance state management using Signals
  private readonly _stores: WritableSignal<Store[]> = signal([]);
  public readonly stores = this._stores.asReadonly();

  // Keep BehaviorSubject for backward compatibility with existing streams if needed,
  // but bridge them here.
  private readonly storesSubject = new BehaviorSubject<Store[]>([]);
  public stores$ = this.storesSubject.asObservable();

  private readonly activeStoreIdSubject = new BehaviorSubject<string | null>(
    localStorage.getItem('jjm_active_store_id')
  );
  public activeStoreId$ = this.activeStoreIdSubject.asObservable();
  public readonly activeStoreId = signal<string | null>(
    localStorage.getItem('jjm_active_store_id')
  );

  private get db() {
    return this.firebaseService.db;
  }

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly indexedDbService: IndexedDbService,
    private readonly loadingService: LoadingService
  ) {
    this.hydrateFromCache();
  }

  private hydrateFromCache(): void {
    this.indexedDbService
      .get('jjm_cached_stores')
      .pipe(take(1))
      .subscribe({
        next: (cached) => {
          if (cached) {
            try {
              this._stores.set(cached);
              this.storesSubject.next(cached);
              // console.log('Hydrated Stores from IndexedDB');
            } catch (e) {
              console.warn('Failed to parse cached stores', e);
            }
          }
        },
        error: (err) =>
          console.warn('Failed to hydrate stores from IndexedDB', err),
      });
  }

  private saveToCache(stores: Store[]): void {
    this.indexedDbService
      .set('jjm_cached_stores', stores)
      .pipe(take(1))
      .subscribe({
        error: (err) => console.error('Failed to save stores to cache', err),
      });
  }

  reset(): void {
    this._stores.set([]);
    this.storesSubject.next([]);
    this.activeStoreIdSubject.next(null);
    this.activeStoreId.set(null);
    this.indexedDbService.delete('jjm_cached_stores').pipe(take(1)).subscribe();
  }

  loadStores(force = false): void {
    // If not forced and already loaded, skip to save on endpoint calls
    if (!force && this._stores().length > 0) {
      console.log('Stores already loaded in Signal. Skipping fetch.');
      return;
    }

    const role = localStorage.getItem('jjm_role');
    const assignedStoreId = localStorage.getItem('jjm_store_id');

    const storesRef = collection(this.db, 'stores');
    let q = query(storesRef, orderBy('createdAt', 'desc'));

    // Security: Admins only see their assigned store
    if (role === 'admin' && assignedStoreId) {
      q = query(storesRef, where('id', '==', assignedStoreId));
    }

    from(getDocs(q)).subscribe({
      next: (snapshot) => {
        const stores: Store[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            ...data,
            id: docSnap.id,
            createdAt: data['createdAt']?.toDate
              ? data['createdAt'].toDate()
              : data['createdAt'],
          } as Store;
        });
        this._stores.set(stores);
        this.storesSubject.next(stores);
        this.saveToCache(stores);
        if (!this.activeStoreId() && stores.length > 0) {
          this.setActiveStore(stores[0].id);
        }
      },
      error: (err) => console.error('Error fetching stores:', err),
    });
  }

  getStoreById(id: string): Observable<Store> {
    const docRef = doc(this.db, 'stores', id);
    return from(getDoc(docRef)).pipe(
      map((docSnap) => {
        if (!docSnap.exists()) {
          throw new Error('Store not found');
        }
        const data = docSnap.data();
        return {
          ...data,
          id: docSnap.id,
          createdAt: data['createdAt']?.toDate
            ? data['createdAt'].toDate()
            : data['createdAt'],
        } as Store;
      })
    );
  }

  createStore(store: Omit<Store, 'id' | 'createdAt'>): Observable<Store> {
    const id = crypto.randomUUID();
    const newStore: Store = {
      ...store,
      id,
      createdAt: new Date(),
    } as Store;

    const sanitized = this.sanitizeData(newStore);

    const docRef = doc(this.db, 'stores', id);
    this.loadingService.show('Creating store...');
    return from(setDoc(docRef, sanitized)).pipe(
      map(() => sanitized),
      tap((created) => {
        const current = this._stores();
        const updated = [...current, created];
        this._stores.set(updated);
        this.storesSubject.next(updated);
        this.saveToCache(updated);
        if (!this.activeStoreId()) {
          this.setActiveStore(created.id);
        }
      }),
      catchError((err) => {
        console.error('Error creating store:', err);
        return throwError(() => err);
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  updateStore(id: string, store: Partial<Store>): Observable<Store> {
    const sanitized = this.sanitizeData(store);
    const docRef = doc(this.db, 'stores', id);
    this.loadingService.show('Updating store...');
    return from(updateDoc(docRef, sanitized)).pipe(
      map(() => {
        const current = this._stores();
        const existing = current.find((s) => s.id === id);
        return { ...existing, ...store } as Store;
      }),
      tap((updated) => {
        const current = this._stores();
        const updatedList = current.map((s) =>
          s.id === id ? { ...s, ...updated } : s
        );
        this._stores.set(updatedList);
        this.storesSubject.next(updatedList);
        this.saveToCache(updatedList);
      }),
      catchError((err) => {
        console.error('Error updating store:', err);
        return throwError(() => err);
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  deleteStore(id: string): Observable<void> {
    const docRef = doc(this.db, 'stores', id);
    this.loadingService.show('Deleting store...');
    return from(deleteDoc(docRef)).pipe(
      tap(() => {
        const current = this._stores();
        const filtered = current.filter((s) => s.id !== id);
        this._stores.set(filtered);
        this.storesSubject.next(filtered);
        this.saveToCache(filtered);
        if (this.activeStoreId() === id) {
          const first = filtered[0];
          this.setActiveStore(first ? first.id : null);
        }
      }),
      catchError((err) => {
        console.error('Error deleting store:', err);
        return throwError(() => err);
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  migrateData(storeId: string): Observable<any> {
    // Migration is no longer needed without backend
    console.warn('migrateData is deprecated - no backend to migrate to');
    return of({ success: true, message: 'Migration deprecated' });
  }

  setActiveStore(id: string | null): void {
    if (id) {
      localStorage.setItem('jjm_active_store_id', id);
    } else {
      localStorage.removeItem('jjm_active_store_id');
    }
    this.activeStoreId.set(id);
    this.activeStoreIdSubject.next(id);
  }

  getActiveStoreId(): string | null {
    return this.activeStoreId();
  }

  hasAiResponseCredits(storeId: string): boolean {
    const store = this.storesSubject.value.find((s) => s.id === storeId);
    if (!store) return false;

    // Pro / Enterprise = Unlimited
    const plan = store.subscriptionPlan || 'Free';
    if (plan === 'Pro' || plan.includes('Pro') || plan.includes('Enterprise')) {
      return true;
    }

    // Starter = Limited (Check credits)
    if (plan === 'Starter' || plan.includes('Starter')) {
      const credits = store.credits?.aiResponse ?? 0;
      return credits > 0;
    }

    // Free = No Access
    return false;
  }

  deductAiResponseCredit(storeId: string): void {
    const store = this.storesSubject.value.find((s) => s.id === storeId);
    if (!store) return;

    const plan = store.subscriptionPlan || 'Free';
    // Only deduct for Starter
    if (plan === 'Starter' || plan.includes('Starter')) {
      const current = store.credits?.aiResponse ?? 0;
      if (current > 0) {
        const newCredits = {
          ...(store.credits || {
            ai: 0,
            callMinutes: 0,
            lastResetDate: new Date(),
          }),
          aiResponse: current - 1,
        };
        // Update without waiting
        this.updateStore(storeId, { credits: newCredits }).subscribe();
      }
    }
  }

  hasTransactionCredits(storeId: string): boolean {
    const store = this.storesSubject.value.find((s) => s.id === storeId);
    if (!store) return false;

    const plan = store.subscriptionPlan || 'Free';
    // Pro / Enterprise = Unlimited
    if (plan === 'Pro' || plan.includes('Pro') || plan.includes('Enterprise')) {
      return true;
    }

    // others = Check Credits
    return (store.credits?.transactions ?? 0) > 0;
  }

  deductTransactionCredit(storeId: string): void {
    const store = this.storesSubject.value.find((s) => s.id === storeId);
    if (!store) return;

    const plan = store.subscriptionPlan || 'Free';
    // Only deduct if NOT Pro/Enterprise
    if (plan === 'Pro' || plan.includes('Pro') || plan.includes('Enterprise')) {
      return;
    }

    const current = store.credits?.transactions ?? 0;
    if (current > 0) {
      const newCredits = {
        ...(store.credits || {
          ai: 0,
          callMinutes: 0,
          lastResetDate: new Date(),
        }),
        transactions: current - 1,
      };
      this.updateStore(storeId, { credits: newCredits }).subscribe();
    }
  }

  hasAiCredits(storeId: string): boolean {
    const store = this.storesSubject.value.find((s) => s.id === storeId);
    if (!store) return false;

    const plan = store.subscriptionPlan || 'Free';
    // Pro / Enterprise = Unlimited
    if (plan === 'Pro' || plan.includes('Pro') || plan.includes('Enterprise')) {
      return true;
    }

    // Starter = Check Credits
    if (plan === 'Starter' || plan.includes('Starter')) {
      return (store.credits?.ai ?? 0) > 0;
    }

    return false;
  }

  deductAiCredit(storeId: string): void {
    const store = this.storesSubject.value.find((s) => s.id === storeId);
    if (!store) return;

    const plan = store.subscriptionPlan || 'Free';
    // Only deduct for Starter
    if (plan === 'Starter' || plan.includes('Starter')) {
      const current = store.credits?.ai ?? 0;
      if (current > 0) {
        const newCredits = {
          ...(store.credits || {
            ai: 0,
            callMinutes: 0,
            lastResetDate: new Date(),
          }),
          ai: current - 1,
        };
        this.updateStore(storeId, { credits: newCredits }).subscribe();
      }
    }
  }

  hasVoiceCallAccess(storeId: string): boolean {
    const store = this.storesSubject.value.find((s) => s.id === storeId);
    if (!store) return false;

    const plan = store.subscriptionPlan || 'Free';
    // Only Pro / Enterprise allowed
    return (
      plan === 'Pro' || plan.includes('Pro') || plan.includes('Enterprise')
    );
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
