import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
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
} from 'firebase/firestore';
import { environment } from '../../environments/environment';
import { Message } from '../models/inventory.models';

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private app = initializeApp(environment.firebaseConfig);
  private db = initializeFirestore(this.app, {
    experimentalForceLongPolling: true,
  });
  private messagesSubject = new BehaviorSubject<Message[]>([]);
  public messages$ = this.messagesSubject.asObservable();

  private logoutSubject = new BehaviorSubject<void>(undefined);
  public logout$ = this.logoutSubject.asObservable();

  constructor() {
    this.listenForMessages();
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
}
