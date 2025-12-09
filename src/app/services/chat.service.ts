import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
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
} from 'firebase/firestore';
import { environment } from '../../environments/environment';
import { Message } from '../models/inventory.models';
export interface UserStatus {
  id: string;
  name: string;
  lastSeen: Date;
  role?: string;
  isOnline?: boolean;
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

  constructor(private firebaseService: FirebaseService) {
    this.app = this.firebaseService.app;
    this.db = this.firebaseService.db;
    this.listenForMessages();
    this.listenForStatus();
  }

  private listenForStatus(): void {
    const statusRef = collection(this.db, 'status');
    const q = query(statusRef); // Get all statuses

    onSnapshot(
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
    const messagesRef = collection(this.db, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'), limit(100));

    onSnapshot(
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
          } as Message;
        });
        this.messagesSubject.next(messages);
      },
      (error) => {
        console.error('Error listening to messages:', error);
      }
    );
  }

  async sendMessage(
    text: string,
    senderName: string,
    conversationId?: string
  ): Promise<void> {
    const messagesRef = collection(this.db, 'messages');
    const userId = localStorage.getItem('jjm_user_id') || null;
    await addDoc(messagesRef, {
      text,
      senderName,
      conversationId,
      timestamp: new Date(),
      userId,
      isRead: false,
    });
  }

  async sendAudioMessage(
    audioBase64: string,
    senderName: string,
    conversationId?: string
  ): Promise<void> {
    const messagesRef = collection(this.db, 'messages');
    const userId = localStorage.getItem('jjm_user_id') || null;
    await addDoc(messagesRef, {
      text: '🎤 Voice Message',
      senderName,
      audioBase64,
      conversationId,
      timestamp: new Date(),
      userId,
      isRead: false,
    });
  }

  async deleteMessage(messageId: string): Promise<void> {
    const messageDocRef = doc(this.db, 'messages', messageId);
    await deleteDoc(messageDocRef);
  }

  async markAsRead(messageIds: string[]): Promise<void> {
    const batch = writeBatch(this.db);
    messageIds.forEach((id) => {
      const ref = doc(this.db, 'messages', id);
      batch.update(ref, { isRead: true });
    });
    await batch.commit();
  }

  getMessages(): Observable<Message[]> {
    return this.messages$;
  }

  triggerLogout(): void {
    this.logoutSubject.next();
  }

  async updatePresence(
    id: string,
    name: string,
    role: string = 'user'
  ): Promise<void> {
    try {
      const statusRef = doc(this.db, 'status', id);
      await setDoc(
        statusRef,
        {
          name,
          role,
          lastSeen: new Date(),
          state: 'online',
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Failed to update presence (check Firestore rules):', e);
    }
  }

  getOnlineUsers(): Observable<UserStatus[]> {
    return this.onlineUsers$;
  }
}
