import { Injectable, signal, WritableSignal, computed } from '@angular/core';
import { BehaviorSubject, Observable, from, of, tap, throwError } from 'rxjs';
import { map, switchMap, take, catchError } from 'rxjs/operators';
import { User } from '../models/inventory.models';
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
export class UserService {
  // Global App State using Signals (High Performance)
  private readonly _users: WritableSignal<User[]> = signal([]);
  public readonly users = this._users.asReadonly();

  private readonly _currentUser: WritableSignal<User | null> = signal(null);
  public readonly currentUser = this._currentUser.asReadonly();

  private usersSubject = new BehaviorSubject<User[]>([]);
  public users$ = this.usersSubject.asObservable();

  private readonly loggedInSubject = new BehaviorSubject<boolean>(
    localStorage.getItem('jjm_logged_in') === 'true'
  );
  public isLoggedIn$ = this.loggedInSubject.asObservable();
  public readonly isLoggedIn = signal<boolean>(
    localStorage.getItem('jjm_logged_in') === 'true'
  );

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private get db() {
    return this.firebaseService.db;
  }

  setLoginState(isLoggedIn: boolean, user?: User): void {
    this.loggedInSubject.next(isLoggedIn);
    this.isLoggedIn.set(isLoggedIn);
    if (user) {
      this._currentUser.set(user);
      this.currentUserSubject.next(user);
      localStorage.setItem('jjm_user_id', user.id);
      localStorage.setItem('jjm_role', user.role);

      // Enforce Store Assignment
      if (user.storeId) {
        localStorage.setItem('jjm_store_id', user.storeId);
        this.storeService.setActiveStore(user.storeId);
      }

      // Save User Details for fallback
      sessionStorage.setItem('jjm_user_details', JSON.stringify(user));
    } else if (!isLoggedIn) {
      this._currentUser.set(null);
      this.currentUserSubject.next(null);
      localStorage.removeItem('jjm_user_id');
      localStorage.removeItem('jjm_role');
      localStorage.removeItem('jjm_store_id');
      sessionStorage.removeItem('jjm_user_details');
    }
  }

  constructor(
    private firebaseService: FirebaseService,
    private storeService: StoreService
  ) {
    this.hydrateFromCache();
  }

  private hydrateFromCache(): void {
    const cached = localStorage.getItem('jjm_cached_users');
    if (cached) {
      try {
        const users = JSON.parse(cached);
        this._users.set(users);
        this.usersSubject.next(users);
        console.log('Hydrated Users from cache');

        // Restore Current User if possible
        const currentUserId = localStorage.getItem('jjm_user_id');
        if (currentUserId) {
          const current = users.find((u: User) => u.id === currentUserId);
          if (current) {
            this._currentUser.set(current);
            this.currentUserSubject.next(current);

            // Enforce Store Assignment on Hydration
            if (current.storeId) {
              this.storeService.setActiveStore(current.storeId);
            }
          }
        }
      } catch (e) {
        console.warn('Failed to hydrate users from cache', e);
      }
    }
  }

  private saveToCache(users: User[]): void {
    localStorage.setItem('jjm_cached_users', JSON.stringify(users));
  }

  // Hash Helper
  private hashPassword(password: string): Observable<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    return from(crypto.subtle.digest('SHA-256', data)).pipe(
      map((hash) =>
        Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      )
    );
  }

  public loadUsers(force = false): void {
    // If not forced and already loaded, skip to save endpoint calls
    if (!force && this._users().length > 0) {
      console.log('Users already loaded in Signal. Skipping fetch.');
      return;
    }

    const currentUser = this.currentUser();
    const currentUserId =
      currentUser?.id || localStorage.getItem('jjm_user_id');
    const userRole = currentUser?.role || localStorage.getItem('jjm_role');
    const storeId =
      currentUser?.storeId || localStorage.getItem('jjm_store_id');

    if (!currentUserId) return;

    const usersRef = collection(this.db, 'users');
    let usersQuery;

    // Security check: Only admins and super-admins should load users
    if (userRole === 'super-admin') {
      // Super-admins see everyone
      usersQuery = query(usersRef);
    } else if (userRole === 'admin' && storeId) {
      // Admins see only users assigned to their store
      usersQuery = query(usersRef, where('storeId', '==', storeId));
    } else {
      // Other users only see themselves
      usersQuery = query(usersRef, where('id', '==', currentUserId));
    }

    from(getDocs(usersQuery)).subscribe({
      next: (snapshot) => {
        const users: User[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return this.transformUser({ id: docSnap.id, ...data });
        });

        if (users.length === 0 && userRole === 'admin' && !storeId) {
          // This case should ideally not happen if stores are assigned properly
          this.initializeDefaultAdmin().subscribe();
        } else {
          this._users.set(users);
          this.usersSubject.next(users);
          this.saveToCache(users);

          // Re-sync current user if found in the list
          const current = users.find((u) => u.id === currentUserId);
          if (current) {
            this._currentUser.set(current);
            this.currentUserSubject.next(current);
          }
        }
      },
      error: (err) => {
        console.error('Error fetching users:', err);
        if (userRole === 'super-admin') {
          this.initializeDefaultAdmin().subscribe();
        }
      },
    });
  }

  private initializeDefaultAdmin(): Observable<void> {
    if (this.usersSubject.value.length > 0) return of(void 0);

    return this.hashPassword('Gr*l0v3R').pipe(
      switchMap((hashedPassword) => {
        const defaultAdmin: User = {
          id: 'admin-1',
          username: 'jjm143256789',
          fullName: 'System Administrator',
          password: hashedPassword,
          role: 'super-admin',
          createdAt: new Date(),
          hasSubscription: true,
        };

        const docRef = doc(this.db, 'users', defaultAdmin.id);
        return from(setDoc(docRef, defaultAdmin)).pipe(
          map(() => {
            const transformed = this.transformUser(defaultAdmin);
            this._users.set([transformed]);
            this.usersSubject.next([transformed]);
            this.saveToCache([transformed]);
          }),
          catchError((e) => {
            console.warn(
              'Could not save default admin to Firestore, using local only',
              e
            );
            this._users.set([defaultAdmin]);
            this.usersSubject.next([defaultAdmin]);
            return of(void 0);
          })
        );
      })
    );
  }

  getUsers(): Observable<User[]> {
    return this.users$;
  }

  addUser(user: Omit<User, 'id' | 'createdAt'>): Observable<User> {
    const id = crypto.randomUUID();
    const newUserTemplate: User = {
      ...user,
      id,
      createdAt: new Date(),
      userId: user.userId || localStorage.getItem('jjm_user_id') || 'system',
      storeId: this.enforceStoreId(user.storeId),
    } as User;

    // Remove undefined fields which Firestore rejects
    const sanitized = this.sanitizeData(newUserTemplate);

    return this.hashPassword(user.password || '').pipe(
      switchMap((hashed) => {
        sanitized.password = hashed;
        const docRef = doc(this.db, 'users', id);
        return from(setDoc(docRef, sanitized)).pipe(
          map(() => {
            const transformed = this.transformUser(sanitized);
            const current = this._users();
            const updated = [...current, transformed];
            this._users.set(updated);
            this.usersSubject.next(updated);
            this.saveToCache(updated);
            return transformed;
          })
        );
      }),
      catchError((err) => {
        console.error('Error adding user:', err);
        throw err;
      })
    );
  }

  updateUser(updatedUser: Partial<User> & { id: string }): Observable<User> {
    const payload = this.sanitizeData({ ...updatedUser });

    // Enforce Store ID restrictions for non-super-admins
    if (payload.storeId) {
      payload.storeId = this.enforceStoreId(payload.storeId);
    }

    const passwordStream$: Observable<string | undefined> = payload.password
      ? this.hashPassword(payload.password)
      : of(undefined);

    return passwordStream$.pipe(
      switchMap((hashedPassword) => {
        if (hashedPassword) {
          payload.password = hashedPassword;
        }

        const docRef = doc(this.db, 'users', payload.id);
        return from(updateDoc(docRef, payload as Record<string, any>)).pipe(
          map(() => {
            const current = this._users();
            const existing = current.find((u) => u.id === payload.id);
            const transformed = this.transformUser({ ...existing, ...payload });
            const updated = current.map((u) =>
              u.id === transformed.id ? transformed : u
            );
            this._users.set(updated);
            this.usersSubject.next(updated);
            this.saveToCache(updated);
            return transformed;
          })
        );
      }),
      catchError((err) => {
        console.error('Error updating user:', err);
        throw err;
      })
    );
  }

  deleteUser(userId: string): Observable<void> {
    const docRef = doc(this.db, 'users', userId);
    return from(deleteDoc(docRef)).pipe(
      map(() => {
        const current = this._users();
        const filtered = current.filter((u) => u.id !== userId);
        this._users.set(filtered);
        this.usersSubject.next(filtered);
        this.saveToCache(filtered);
      }),
      catchError((err) => {
        console.error('Error deleting user:', err);
        throw err;
      })
    );
  }

  getUserById(id: string): User | undefined {
    return this.usersSubject.value.find((u) => u.id === id);
  }

  validateCredentials(
    username: string,
    password: string
  ): Observable<User | null> {
    return this.hashPassword(password).pipe(
      switchMap((hashedInput) => {
        const usersRef = collection(this.db, 'users');
        const q = query(usersRef, where('username', '==', username));

        return from(getDocs(q)).pipe(
          map((snapshot) => {
            if (snapshot.empty) return null;

            const docSnap = snapshot.docs[0];
            const userData = docSnap.data();

            // Validate password
            if (userData['password'] !== hashedInput) {
              return null;
            }

            const user = this.transformUser({ id: docSnap.id, ...userData });
            if (user.storeId) {
              this.storeService.setActiveStore(user.storeId);
            }
            return user;
          }),
          catchError((err) => {
            console.error('Login error:', err);
            return of(null);
          })
        );
      })
    );
  }

  private transformUser(user: any): User {
    const transformed: User = {
      ...user,
      createdAt: this.parseDate(user.createdAt),
    };
    // Force subscription for admin for demo purposes
    if (
      transformed.role === 'admin' ||
      transformed.role === 'super-admin' ||
      transformed.username === 'jjm143256789'
    ) {
      transformed.hasSubscription = true;
    }

    // Only force super-admin for the system administrator
    if (transformed.username === 'jjm143256789') {
      transformed.role = 'super-admin';
    }
    return transformed;
  }

  private parseDate(date: any): Date {
    if (!date) return new Date();
    if (date instanceof Date) return date;
    if (typeof date === 'string') return new Date(date);
    if (typeof date === 'object' && date._seconds !== undefined) {
      return new Date(date._seconds * 1000);
    }
    if (typeof date === 'object' && date.toDate) {
      return date.toDate();
    }
    return new Date(date);
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
