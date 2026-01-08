import { Injectable, signal, WritableSignal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Store } from '../models/inventory.models';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class StoreService {
  private readonly apiUrl = environment.apiUrl;

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

  constructor(private readonly http: HttpClient) {
    this.hydrateFromCache();
  }

  private hydrateFromCache(): void {
    const cached = localStorage.getItem('jjm_cached_stores');
    if (cached) {
      try {
        const stores = JSON.parse(cached);
        this._stores.set(stores);
        this.storesSubject.next(stores);
        console.log('Hydrated Stores from cache');
      } catch (e) {
        console.warn('Failed to hydrate stores from cache', e);
      }
    }
  }

  private saveToCache(stores: Store[]): void {
    localStorage.setItem('jjm_cached_stores', JSON.stringify(stores));
  }

  reset(): void {
    this._stores.set([]);
    this.storesSubject.next([]);
    this.activeStoreIdSubject.next(null);
    this.activeStoreId.set(null);
    localStorage.removeItem('jjm_cached_stores');
  }

  loadStores(force = false): void {
    // If not forced and already loaded, skip to save on endpoint calls
    if (!force && this._stores().length > 0) {
      console.log('Stores already loaded in Signal. Skipping fetch.');
      return;
    }

    this.http.get<Store[]>(`${this.apiUrl}/stores`).subscribe({
      next: (stores) => {
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
    return this.http.get<Store>(`${this.apiUrl}/stores/${id}`);
  }

  createStore(store: Omit<Store, 'id' | 'createdAt'>): Observable<Store> {
    return this.http.post<Store>(`${this.apiUrl}/stores`, store).pipe(
      tap((newStore) => {
        const current = this._stores();
        const updated = [...current, newStore];
        this._stores.set(updated);
        this.storesSubject.next(updated);
        this.saveToCache(updated);
        if (!this.activeStoreId()) {
          this.setActiveStore(newStore.id);
        }
      })
    );
  }

  updateStore(id: string, store: Partial<Store>): Observable<Store> {
    return this.http.put<Store>(`${this.apiUrl}/stores/${id}`, store).pipe(
      tap((updated) => {
        const current = this._stores();
        const updatedList = current.map((s) =>
          s.id === id ? { ...s, ...updated } : s
        );
        this._stores.set(updatedList);
        this.storesSubject.next(updatedList);
        this.saveToCache(updatedList);
      })
    );
  }

  deleteStore(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/stores/${id}`).pipe(
      tap(() => {
        const current = this._stores();
        const filtered = current.filter((s) => s.id !== id);
        this._stores.set(filtered);
        this.storesSubject.next(filtered);
        if (this.activeStoreId() === id) {
          const first = filtered[0];
          this.setActiveStore(first ? first.id : null);
        }
      })
    );
  }

  migrateData(storeId: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/stores/migrate`, { storeId });
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
