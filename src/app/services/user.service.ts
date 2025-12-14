import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { map, switchMap, take, catchError } from 'rxjs/operators';
import { User } from '../models/inventory.models';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private apiUrl = environment.apiUrl;
  private usersSubject = new BehaviorSubject<User[]>([]);
  public users$ = this.usersSubject.asObservable();

  private loggedInSubject = new BehaviorSubject<boolean>(
    localStorage.getItem('jjm_logged_in') === 'true'
  );
  public isLoggedIn$ = this.loggedInSubject.asObservable();

  setLoginState(isLoggedIn: boolean): void {
    this.loggedInSubject.next(isLoggedIn);
  }

  constructor(private http: HttpClient) {
    // Removed automatic loading of all users on startup for security
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

  public loadUsers(): void {
    this.http.get<User[]>(`${this.apiUrl}/users`).subscribe({
      next: (users) => {
        const parsedUsers = users.map((user) => this.transformUser(user));
        if (parsedUsers.length === 0) {
          this.initializeDefaultAdmin().subscribe();
        } else {
          this.usersSubject.next(parsedUsers);
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
            this.usersSubject.next([transformed]);
          }),
          catchError((e) => {
            console.warn(
              'Could not save default admin to backend, using local only',
              e
            );
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
        const current = this.usersSubject.value;
        this.usersSubject.next([...current, transformed]);
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
        const current = this.usersSubject.value;
        const updated = current.map((u) =>
          u.id === transformed.id ? transformed : u
        );
        this.usersSubject.next(updated);
        return transformed;
      })
    );
  }

  deleteUser(userId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/users/${userId}`).pipe(
      map(() => {
        const current = this.usersSubject.value;
        this.usersSubject.next(current.filter((u) => u.id !== userId));
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
              return this.transformUser(user);
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
