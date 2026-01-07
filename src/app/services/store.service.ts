import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Store } from '../models/inventory.models';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class StoreService {
  private apiUrl = environment.apiUrl;
  private storesSubject = new BehaviorSubject<Store[]>([]);
  public stores$ = this.storesSubject.asObservable();

  private activeStoreIdSubject = new BehaviorSubject<string | null>(
    localStorage.getItem('jjm_active_store_id')
  );
  public activeStoreId$ = this.activeStoreIdSubject.asObservable();

  constructor(private http: HttpClient) {}

  loadStores(): void {
    this.http.get<Store[]>(`${this.apiUrl}/stores`).subscribe({
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
    return this.http.get<Store>(`${this.apiUrl}/stores/${id}`);
  }

  createStore(store: Omit<Store, 'id' | 'createdAt'>): Observable<Store> {
    return this.http.post<Store>(`${this.apiUrl}/stores`, store).pipe(
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
    return this.http.put<Store>(`${this.apiUrl}/stores/${id}`, store).pipe(
      tap((updated) => {
        const current = this.storesSubject.value;
        this.storesSubject.next(
          current.map((s) => (s.id === id ? { ...s, ...updated } : s))
        );
      })
    );
  }

  deleteStore(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/stores/${id}`).pipe(
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
    return this.http.post<any>(`${this.apiUrl}/stores/migrate`, { storeId });
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
}
