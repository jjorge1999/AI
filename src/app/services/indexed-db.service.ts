import { Injectable } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import {
  map,
  switchMap,
  catchError,
  shareReplay,
  take,
  tap,
} from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class IndexedDbService {
  private dbName = 'jjm_inventory_db';
  private storeName = 'cache';
  private db$: Observable<IDBDatabase>;

  constructor() {
    this.db$ = this.initDB().pipe(shareReplay(1));
  }

  private initDB(): Observable<IDBDatabase> {
    return new Observable<IDBDatabase>((observer) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };

      request.onsuccess = (event: any) => {
        observer.next(event.target.result);
        observer.complete();
      };

      request.onerror = (event: any) => {
        console.error('IndexedDB error:', event.target.error);
        observer.error(event.target.error);
      };
    });
  }

  get(key: string): Observable<any> {
    return this.db$.pipe(
      take(1),
      switchMap((db) => {
        return new Observable<any>((observer) => {
          try {
            const transaction = db.transaction(this.storeName, 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onsuccess = () => {
              observer.next(request.result);
              observer.complete();
            };

            request.onerror = (event: any) => {
              observer.error(request.error);
            };
          } catch (err) {
            observer.error(err);
          }
        });
      }),
      catchError((err) => {
        console.warn('IndexedDbService: Failed to get key', key, err);
        return of(null);
      })
    );
  }

  set(key: string, value: any): Observable<void> {
    return this.db$.pipe(
      take(1),
      switchMap((db) => {
        return new Observable<void>((observer) => {
          try {
            const transaction = db.transaction(this.storeName, 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(value, key);

            request.onsuccess = () => {
              observer.next();
              observer.complete();
            };

            request.onerror = (event: any) => {
              observer.error(request.error);
            };
          } catch (err) {
            observer.error(err);
          }
        });
      }),
      catchError((err) => {
        console.error('IndexedDbService: Failed to set key', key, err);
        return throwError(() => err);
      })
    );
  }

  delete(key: string): Observable<void> {
    return this.db$.pipe(
      take(1),
      switchMap((db) => {
        return new Observable<void>((observer) => {
          try {
            const transaction = db.transaction(this.storeName, 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);

            request.onsuccess = () => {
              observer.next();
              observer.complete();
            };

            request.onerror = (event: any) => {
              observer.error(request.error);
            };
          } catch (err) {
            observer.error(err);
          }
        });
      }),
      catchError((err) => {
        console.error('IndexedDbService: Failed to delete key', key, err);
        return throwError(() => err);
      })
    );
  }

  clear(): Observable<void> {
    return this.db$.pipe(
      take(1),
      switchMap((db) => {
        return new Observable<void>((observer) => {
          try {
            const transaction = db.transaction(this.storeName, 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();

            request.onsuccess = () => {
              observer.next();
              observer.complete();
            };

            request.onerror = (event: any) => {
              observer.error(request.error);
            };
          } catch (err) {
            observer.error(err);
          }
        });
      }),
      catchError((err) => {
        console.error('IndexedDbService: Failed to clear cache', err);
        return throwError(() => err);
      })
    );
  }
}
