import { Injectable, signal, WritableSignal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, from, of, tap } from 'rxjs';
import { map, switchMap, take, catchError } from 'rxjs/operators';
import { User } from '../models/inventory.models';
import { environment } from '../../environments/environment';
import { StoreService } from './store.service';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private apiUrl = environment.apiUrl;

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

  setLoginState(isLoggedIn: boolean, user?: User): void {
    this.loggedInSubject.next(isLoggedIn);
    this.isLoggedIn.set(isLoggedIn);
    if (user) {
      this._currentUser.set(user);
      this.currentUserSubject.next(user);
      localStorage.setItem('jjm_user_id', user.id);
      localStorage.setItem('jjm_user_role', user.role);
    } else if (!isLoggedIn) {
      this._currentUser.set(null);
      this.currentUserSubject.next(null);
    }
  }

  constructor(private http: HttpClient, private storeService: StoreService) {
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

    const currentUserId = localStorage.getItem('jjm_user_id');
    this.http.get<User[]>(`${this.apiUrl}/users`).subscribe({
      next: (users) => {
        const parsedUsers = users.map((user) => this.transformUser(user));
        if (parsedUsers.length === 0) {
          this.initializeDefaultAdmin().subscribe();
        } else {
          this._users.set(parsedUsers);
          this.usersSubject.next(parsedUsers);
          if (currentUserId) {
            const current = parsedUsers.find((u) => u.id === currentUserId);
            if (current) {
              this._currentUser.set(current);
              this.currentUserSubject.next(current);
            }
          }
        }
      },
      error: (err) => {
        console.error('Error fetching users:', err);
        if (err.status === 404) {
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
          role: 'admin',
          createdAt: new Date(),
          hasSubscription: true,
        };

        return this.http.post<User>(`${this.apiUrl}/users`, defaultAdmin).pipe(
          map((saved) => {
            const transformed = this.transformUser(saved);
            this._users.set([transformed]);
            this.usersSubject.next([transformed]);
          }),
          catchError((e) => {
            console.warn(
              'Could not save default admin to backend, using local only',
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
    const newUserTemplate = {
      ...user,
      createdAt: new Date(),
      userId: user.userId || localStorage.getItem('jjm_user_id') || 'system',
    };

    return this.hashPassword(user.password || '').pipe(
      switchMap((hashed) => {
        newUserTemplate.password = hashed;
        return this.http.post<User>(`${this.apiUrl}/users`, newUserTemplate);
      }),
      map((savedUser) => {
        const transformed = this.transformUser(savedUser);
        const current = this._users();
        const updated = [...current, transformed];
        this._users.set(updated);
        this.usersSubject.next(updated);
        this.saveToCache(updated);
        return transformed;
      })
    );
  }

  updateUser(updatedUser: Partial<User> & { id: string }): Observable<User> {
    const payload = { ...updatedUser };

    const passwordStream$: Observable<string | undefined> = payload.password
      ? this.hashPassword(payload.password)
      : of(undefined);

    return passwordStream$.pipe(
      switchMap((hashedPassword) => {
        if (hashedPassword) {
          payload.password = hashedPassword;
        }

        return this.http.put<User>(
          `${this.apiUrl}/users/${payload.id}`,
          payload
        );
      }),
      map((saved) => {
        const transformed = this.transformUser(saved);
        const current = this._users();
        const updated = current.map((u) =>
          u.id === transformed.id ? transformed : u
        );
        this._users.set(updated);
        this.usersSubject.next(updated);
        this.saveToCache(updated);
        return transformed;
      })
    );
  }

  deleteUser(userId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/users/${userId}`).pipe(
      map(() => {
        const current = this._users();
        const filtered = current.filter((u) => u.id !== userId);
        this._users.set(filtered);
        this.usersSubject.next(filtered);
        this.saveToCache(filtered);
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
      switchMap((hashedInput) =>
        this.http
          .post<User>(`${this.apiUrl}/login`, {
            username,
            password: hashedInput,
          })
          .pipe(
            map((user) => {
              if (!user) return null;
              const transformed = this.transformUser(user);
              if (transformed.storeId) {
                this.storeService.setActiveStore(transformed.storeId);
              }
              return transformed;
            }),
            // Catch 401 (Unauthorized) or other errors and return null
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            catchError((err) => {
              return of(null);
            })
          )
      )
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
      transformed.username === 'jjm143256789'
    ) {
      transformed.hasSubscription = true;
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
    return new Date(date);
  }
}
