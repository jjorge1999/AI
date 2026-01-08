import { Injectable } from '@angular/core';
import { BehaviorSubject, from, Observable, of } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { Store } from '../models/inventory.models';
import { environment } from '../../environments/environment';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { FirebaseService } from './firebase.service';

@Injectable({
  providedIn: 'root',
})
export class StoreService {
  private storesCollection = collection(this.firebaseService.db, 'stores');
  private readonly storesSubject = new BehaviorSubject<Store[]>([]);
  public stores$ = this.storesSubject.asObservable();

  private readonly activeStoreIdSubject = new BehaviorSubject<string | null>(
    localStorage.getItem('jjm_active_store_id')
  );
  public activeStoreId$ = this.activeStoreIdSubject.asObservable();

  constructor(private readonly firebaseService: FirebaseService) {}

  reset(): void {
    this.storesSubject.next([]);
    this.activeStoreIdSubject.next(null);
  }

  private transformStore(doc: any): Store {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: (data.createdAt as Timestamp)?.toDate(),
      subscriptionExpiryDate: (data.subscriptionExpiryDate as Timestamp)?.toDate(),
    } as Store;
  }

  loadStores(): void {
    from(getDocs(this.storesCollection)).pipe(
      map((snapshot) => snapshot.docs.map(this.transformStore))
    ).subscribe({
      next: (stores) => {
        this.storesSubject.next(stores);
        if (!this.activeStoreIdSubject.value && stores.length > 0) {
          this.setActiveStore(stores[0].id);
        }
      },
      error: (err) => console.error('Error fetching stores:', err),
    });
  }

  getStoreById(id: string): Observable<Store> {
    const storeDoc = doc(this.firebaseService.db, 'stores', id);
    return from(getDoc(storeDoc)).pipe(
      map((doc) => this.transformStore(doc))
    );
  }

  createStore(store: Omit<Store, 'id' | 'createdAt'>): Observable<Store> {
    const newStore = { ...store, createdAt: serverTimestamp() };
    return from(addDoc(this.storesCollection, newStore)).pipe(
      switchMap((docRef) => this.getStoreById(docRef.id)),
      tap((newStore) => {
        const current = this.storesSubject.value;
        this.storesSubject.next([...current, newStore]);
        if (!this.activeStoreIdSubject.value) {
          this.setActiveStore(newStore.id);
        }
      })
    );
  }

  updateStore(id: string, store: Partial<Store>): Observable<Store> {
    const storeDoc = doc(this.firebaseService.db, 'stores', id);
    return from(updateDoc(storeDoc, store)).pipe(
      switchMap(() => this.getStoreById(id)),
      tap((updated) => {
        const current = this.storesSubject.value;
        this.storesSubject.next(
          current.map((s) => (s.id === id ? { ...s, ...updated } : s))
        );
      })
    );
  }

  deleteStore(id: string): Observable<void> {
    const storeDoc = doc(this.firebaseService.db, 'stores', id);
    return from(deleteDoc(storeDoc)).pipe(
      tap(() => {
        const current = this.storesSubject.value;
        this.storesSubject.next(current.filter((s) => s.id !== id));
        if (this.activeStoreIdSubject.value === id) {
          const first = this.storesSubject.value[0];
          this.setActiveStore(first ? first.id : null);
        }
      })
    );
  }

  migrateData(storeId: string): Observable<any> {
    const storeDoc = doc(this.firebaseService.db, 'stores', storeId);
    return from(updateDoc(storeDoc, { migrated: true }));
  }

  setActiveStore(id: string | null): void {
    if (id) {
      localStorage.setItem('jjm_active_store_id', id);
    } else {
      localStorage.removeItem('jjm_active_store_id');
    }
    this.activeStoreIdSubject.next(id);
  }

  getActiveStoreId(): string | null {
    return this.activeStoreIdSubject.value;
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
      // Default to 0 if undefined. (Initialization logic should handle setting this to 1000)
      // Note: If newly created without credits, it might block. We can leniently allow unless explicitly 0 if we assume fresh accounts have it.
      // But adhering to strict credit field is safer.
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
}
