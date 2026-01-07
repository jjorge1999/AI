import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from, of, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { FirebaseService } from './firebase.service';
import { FirebaseApp } from 'firebase/app';
import {
  Firestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  Timestamp,
  deleteDoc,
  doc,
  updateDoc,
  writeBatch,
  setDoc,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { Message } from '../models/inventory.models';
import { StoreService } from './store.service';

export interface UserStatus {
  id: string;
  name: string;
  lastSeen: Date;
  role?: string;
  isOnline?: boolean;
  storeId?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private app: FirebaseApp;
  private db: Firestore;
  private messagesSubject = new BehaviorSubject<Message[]>([]);
  public messages$ = this.messagesSubject.asObservable();

  private onlineUsersSubject = new BehaviorSubject<UserStatus[]>([]);
  public onlineUsers$ = this.onlineUsersSubject.asObservable();

  private logoutSubject = new BehaviorSubject<void>(undefined);
  public logout$ = this.logoutSubject.asObservable();

  private msgUnsubscribe: Unsubscribe | null = null;
  private statusUnsubscribe: Unsubscribe | null = null;

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly storeService: StoreService
  ) {
    this.app = this.firebaseService.app;
    this.db = this.firebaseService.db;

    // Auto-refresh when store changes
    this.storeService.activeStoreId$.subscribe(() => {
      this.resetListeners();
    });
  }

  private resetListeners(): void {
    if (this.msgUnsubscribe) {
      this.msgUnsubscribe();
      this.msgUnsubscribe = null;
    }
    if (this.statusUnsubscribe) {
      this.statusUnsubscribe();
      this.statusUnsubscribe = null;
    }
    this.listenForMessages();
    this.listenForStatus();
  }

  private listenForStatus(): void {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      this.onlineUsersSubject.next([]);
      return;
    }

    const statusRef = collection(this.db, 'status');
    const q = query(statusRef, where('storeId', '==', activeStoreId));

    this.statusUnsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const now = new Date();
        const statuses = snapshot.docs.map((doc) => {
          const data = doc.data();
          const lastSeen = (data['lastSeen'] as Timestamp).toDate();
          // Online if seen in last 2 minutes
          const isOnline = now.getTime() - lastSeen.getTime() < 2 * 60 * 1000;
          return {
            id: doc.id,
            name: data['name'],
            role: data['role'],
            lastSeen: lastSeen,
            isOnline: isOnline,
            storeId: data['storeId'],
          } as UserStatus;
        });
        this.onlineUsersSubject.next(statuses);
      },
      (error) => {
        console.warn(
          'Status update listener failed (check Firestore rules):',
          error
        );
      }
    );
  }

  private listenForMessages(): void {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      this.messagesSubject.next([]);
      return;
    }

    const messagesRef = collection(this.db, 'messages');
    const q = query(
      messagesRef,
      where('storeId', '==', activeStoreId),
      orderBy('timestamp', 'asc'),
      limit(100)
    );

    this.msgUnsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const messages = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            text: data['text'],
            senderName: data['senderName'],
            timestamp: (data['timestamp'] as Timestamp).toDate(),
            userId: data['userId'],
            conversationId: data['conversationId'],
            audioBase64: data['audioBase64'],
            isRead: data['isRead'] || false,
            storeId: data['storeId'],
          } as Message;
        });
        this.messagesSubject.next(messages);
      },
      (error) => {
        console.error('Error listening to messages:', error);
      }
    );
  }

  sendMessage(
    text: string,
    senderName: string,
    conversationId?: string
  ): Observable<void> {
    const messagesRef = collection(this.db, 'messages');
    const userId = localStorage.getItem('jjm_user_id') || null;
    const storeId = this.storeService.getActiveStoreId();

    if (!storeId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    return from(
      addDoc(messagesRef, {
        text,
        senderName,
        conversationId,
        timestamp: new Date(),
        userId,
        isRead: false,
        storeId: storeId,
      })
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        console.error('Error sending message:', error);
        return of(void 0);
      })
    );
  }

  sendAudioMessage(
    audioBase64: string,
    senderName: string,
    conversationId?: string
  ): Observable<void> {
    const messagesRef = collection(this.db, 'messages');
    const userId = localStorage.getItem('jjm_user_id') || null;
    const storeId = this.storeService.getActiveStoreId();

    if (!storeId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    return from(
      addDoc(messagesRef, {
        text: '🎤 Voice Message',
        senderName,
        audioBase64,
        conversationId,
        timestamp: new Date(),
        userId,
        isRead: false,
        storeId: storeId,
      })
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        console.error('Error sending audio message:', error);
        return of(void 0);
      })
    );
  }

  deleteMessage(messageId: string): Observable<void> {
    const messageDocRef = doc(this.db, 'messages', messageId);
    return from(deleteDoc(messageDocRef)).pipe(
      map(() => void 0),
      catchError((error) => {
        console.error('Error deleting message:', error);
        return of(void 0);
      })
    );
  }

  markAsRead(messageIds: string[]): Observable<void> {
    const batch = writeBatch(this.db);
    messageIds.forEach((id) => {
      const ref = doc(this.db, 'messages', id);
      batch.update(ref, { isRead: true });
    });
    return from(batch.commit()).pipe(
      map(() => void 0),
      catchError((error) => {
        console.error('Error marking messages as read:', error);
        return of(void 0);
      })
    );
  }

  getMessages(): Observable<Message[]> {
    return this.messages$;
  }

  triggerLogout(): void {
    this.logoutSubject.next();
  }

  updatePresence(
    id: string,
    name: string,
    role: string = 'user'
  ): Observable<void> {
    const statusRef = doc(this.db, 'status', id);
    const storeId = this.storeService.getActiveStoreId();
    if (!storeId) return of(void 0);

    return from(
      setDoc(
        statusRef,
        {
          name,
          role,
          storeId: storeId,
          lastSeen: new Date(),
          state: 'online',
        },
        { merge: true }
      )
    ).pipe(
      map(() => void 0),
      catchError((e) => {
        console.warn('Failed to update presence (check Firestore rules):', e);
        return of(void 0);
      })
    );
  }

  getOnlineUsers(): Observable<UserStatus[]> {
    return this.onlineUsers$;
  }
}
