import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  Timestamp,
} from 'firebase/firestore';
import { environment } from '../../environments/environment';
import { Message } from '../models/inventory.models';

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private app = initializeApp(environment.firebaseConfig);
  private db = getFirestore(this.app);
  private messagesSubject = new BehaviorSubject<Message[]>([]);
  public messages$ = this.messagesSubject.asObservable();

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
          } as Message;
        });
        this.messagesSubject.next(messages);
      },
      (error) => {
        console.error('Error listening to messages:', error);
      }
    );
  }

  async sendMessage(text: string, senderName: string): Promise<void> {
    const messagesRef = collection(this.db, 'messages');
    await addDoc(messagesRef, {
      text,
      senderName,
      timestamp: new Date(),
    });
  }

  getMessages(): Observable<Message[]> {
    return this.messages$;
  }
}
