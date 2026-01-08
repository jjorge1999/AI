import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { User } from '../models/inventory.models';
import { StoreService } from './store.service';
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
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { FirebaseService } from './firebase.service';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, deleteUser as deleteUserAuth, updatePassword } from 'firebase/auth';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private usersCollection = collection(this.firebaseService.db, 'users');
  private usersSubject = new BehaviorSubject<User[]>([]);
  public users$ = this.usersSubject.asObservable();

  private readonly loggedInSubject = new BehaviorSubject<boolean>(
    localStorage.getItem('jjm_logged_in') === 'true'
  );
  public isLoggedIn$ = this.loggedInSubject.asObservable();

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  setLoginState(isLoggedIn: boolean, user?: User): void {
    this.loggedInSubject.next(isLoggedIn);
    if (user) {
      this.currentUserSubject.next(user);
      localStorage.setItem('jjm_user_id', user.id);
      localStorage.setItem('jjm_user_role', user.role);
    } else if (!isLoggedIn) {
      this.currentUserSubject.next(null);
    }
  }

  constructor(
    private storeService: StoreService,
    private firebaseService: FirebaseService
  ) {
    // Removed automatic loading of all users on startup for security
  }

  public loadUsers(): void {
    const currentUserId = localStorage.getItem('jjm_user_id');
    from(getDocs(this.usersCollection)).pipe(
      map((snapshot) => snapshot.docs.map(doc => this.transformUser({ id: doc.id, ...doc.data() })))
    ).subscribe({
      next: (users) => {
        if (users.length === 0) {
          this.initializeDefaultAdmin().subscribe();
        } else {
          this.usersSubject.next(users);
          if (currentUserId) {
            const current = users.find((u) => u.id === currentUserId);
            if (current) this.currentUserSubject.next(current);
          }
        }
      },
      error: (err) => {
        console.error('Error fetching users:', err);
        this.initializeDefaultAdmin().subscribe();
      },
    });
  }

  private initializeDefaultAdmin(): Observable<void> {
    if (this.usersSubject.value.length > 0) return of(void 0);
    const auth = getAuth(this.firebaseService.app);
    const defaultAdmin: User = {
      id: 'admin-1',
      username: 'jjm143256789',
      fullName: 'System Administrator',
      password: 'Gr*l0v3R',
      role: 'admin',
      createdAt: new Date(),
      hasSubscription: true,
    };

    return from(createUserWithEmailAndPassword(auth, defaultAdmin.username, defaultAdmin.password || '')).pipe(
      switchMap((userCredential) => {
        const newUser = { ...defaultAdmin, id: userCredential.user.uid };
        delete newUser.password;
        return from(addDoc(this.usersCollection, { ...newUser, createdAt: serverTimestamp() })).pipe(
          map(() => {
            this.usersSubject.next([this.transformUser(newUser)]);
            return of(void 0);
          })
        )
      }),
      catchError((e) => {
        console.warn(
          'Could not save default admin to backend, using local only',
          e
        );
        this.usersSubject.next([defaultAdmin]);
        return of(void 0);
      })
    ) as Observable<void>;
  }

  getUsers(): Observable<User[]> {
    return this.users$;
  }

  getUser(id: string): Observable<User> {
    const userDoc = doc(this.firebaseService.db, 'users', id);
    return from(getDoc(userDoc)).pipe(
      map(doc => this.transformUser({ id: doc.id, ...doc.data() }))
    );
  }

  addUser(user: Omit<User, 'id' | 'createdAt'>): Observable<User> {
    const auth = getAuth(this.firebaseService.app);
    const newUserTemplate = {
      ...user,
      createdAt: new Date(),
      userId: user.userId || localStorage.getItem('jjm_user_id') || 'system',
    };

    return from(createUserWithEmailAndPassword(auth, user.username, user.password || '')).pipe(
      switchMap((userCredential) => {
        const newUser = { ...newUserTemplate, id: userCredential.user.uid };
        delete newUser.password;
        return from(addDoc(this.usersCollection, { ...newUser, createdAt: serverTimestamp() })).pipe(
          map(() => {
            const current = this.usersSubject.value;
            this.usersSubject.next([...current, newUser]);
            return newUser;
          })
        )
      })
    );
  }

  updateUserPassword(password: string): Observable<void> {
    const auth = getAuth(this.firebaseService.app);
    const user = auth.currentUser;
    if (user) {
      return from(updatePassword(user, password));
    }
    return of(void 0);
  }

  updateUser(updatedUser: Partial<User> & { id: string }): Observable<User> {
    const payload = { ...updatedUser };
    const userDoc = doc(this.firebaseService.db, 'users', payload.id);
    const passwordUpdate$ = payload.password ? this.updateUserPassword(payload.password) : of(void 0);
    delete payload.password;

    return passwordUpdate$.pipe(
      switchMap(() => from(updateDoc(userDoc, payload))),
      switchMap(() => this.getUser(payload.id)),
      map((saved) => {
        const current = this.usersSubject.value;
        const updated = current.map((u) =>
          u.id === saved.id ? saved : u
        );
        this.usersSubject.next(updated);
        return saved;
      })
    );
  }

  deleteUser(userId: string): Observable<void> {
    const auth = getAuth(this.firebaseService.app);
    const user = auth.currentUser;
    if (user && user.uid === userId) {
      const userDoc = doc(this.firebaseService.db, 'users', userId);
      return from(deleteUserAuth(user)).pipe(
        switchMap(() => from(deleteDoc(userDoc))),
        map(() => {
          const current = this.usersSubject.value;
          this.usersSubject.next(current.filter((u) => u.id !== userId));
        })
      );
    }
    return of(void 0);
  }

  getUserById(id: string): User | undefined {
    return this.usersSubject.value.find((u) => u.id === id);
  }

  validateCredentials(
    username: string,
    password: string
  ): Observable<User | null> {
    const auth = getAuth(this.firebaseService.app);
    return from(signInWithEmailAndPassword(auth, username, password)).pipe(
      switchMap((userCredential) => {
        const q = query(this.usersCollection, where('username', '==', username));
        return from(getDocs(q)).pipe(
          map((snapshot) => {
            if (snapshot.empty) return null;
            const userDoc = snapshot.docs[0];
            const user = this.transformUser({ id: userDoc.id, ...userDoc.data() });
            if (user.storeId) {
              this.storeService.setActiveStore(user.storeId);
            }
            return user;
          })
        );
      }),
      catchError(() => of(null))
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
