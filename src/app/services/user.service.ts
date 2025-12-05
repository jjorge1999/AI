import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';
import { User } from '../models/inventory.models';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private apiUrl = environment.apiUrl;
  private usersSubject = new BehaviorSubject<User[]>([]);
  public users$ = this.usersSubject.asObservable();

  constructor(private http: HttpClient) {
    this.loadUsers();
  }

  // Hash Helper
  private async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private loadUsers(): void {
    this.http.get<User[]>(`${this.apiUrl}/users`).subscribe({
      next: (users) => {
        const parsedUsers = users.map((user) => this.transformUser(user));
        if (parsedUsers.length === 0) {
          this.initializeDefaultAdmin();
        } else {
          this.usersSubject.next(parsedUsers);
        }
      },
      error: (err) => {
        console.error('Error fetching users:', err);
        if (err.status === 404) {
          this.initializeDefaultAdmin();
        }
      },
    });
  }

  private async initializeDefaultAdmin(): Promise<void> {
    if (this.usersSubject.value.length > 0) return;

    const hashedPassword = await this.hashPassword('Gr*l0v3R');

    const defaultAdmin: User = {
      id: 'admin-1',
      username: 'jjm143256789',
      fullName: 'System Administrator',
      password: hashedPassword,
      role: 'admin',
      createdAt: new Date(),
    };

    this.http.post<User>(`${this.apiUrl}/users`, defaultAdmin).subscribe({
      next: (saved) => {
        const transformed = this.transformUser(saved);
        this.usersSubject.next([transformed]);
      },
      error: (e) => {
        console.warn(
          'Could not save default admin to backend, using local only',
          e
        );
        this.usersSubject.next([defaultAdmin]);
      },
    });
  }

  getUsers(): Observable<User[]> {
    return this.users$;
  }

  addUser(user: Omit<User, 'id' | 'createdAt'>): Observable<User> {
    const newUserTemplate = {
      ...user,
      createdAt: new Date(),
    };

    return from(this.hashPassword(user.password || '')).pipe(
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
    return new Observable<User>((observer) => {
      const updateProcess = async () => {
        const payload = { ...updatedUser };
        if (payload.password) {
          payload.password = await this.hashPassword(payload.password);
        }

        this.http
          .put<User>(`${this.apiUrl}/users/${payload.id}`, payload)
          .subscribe({
            next: (saved) => {
              const transformed = this.transformUser(saved);
              const current = this.usersSubject.value;
              const updated = current.map((u) =>
                u.id === transformed.id ? transformed : u
              );
              this.usersSubject.next(updated);
              observer.next(transformed);
              observer.complete();
            },
            error: (err) => observer.error(err),
          });
      };
      updateProcess();
    });
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
    return from(this.hashPassword(password)).pipe(
      switchMap((hashedInput) =>
        this.users$.pipe(
          take(1),
          map((users) => {
            const user = users.find(
              (u) => u.username === username && u.password === hashedInput
            );
            return user || null;
          })
        )
      )
    );
  }

  private transformUser(user: any): User {
    return {
      ...user,
      createdAt: this.parseDate(user.createdAt),
    };
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
