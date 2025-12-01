import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { Message } from '../models/inventory.models';

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private apiUrl = 'http://localhost:3000/api/messages';
  private socketUrl = 'http://localhost:3001';
  private socket: Socket;
  private messagesSubject = new BehaviorSubject<Message[]>([]);
  public messages$ = this.messagesSubject.asObservable();
  private currentMessages: Message[] = [];

  constructor(private http: HttpClient) {
    // Initialize Socket connection
    this.socket = io(this.socketUrl);

    // Load initial history
    this.loadMessages();

    // Listen for real-time messages
    this.socket.on('new-message', (message: Message) => {
      this.handleNewMessage(message);
    });
  }

  private loadMessages(): void {
    this.http.get<Message[]>(this.apiUrl).subscribe({
      next: (messages) => {
        this.currentMessages = messages.map((m) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        }));
        this.messagesSubject.next(this.currentMessages);
      },
      error: (error) => {
        console.error('Error loading messages:', error);
      },
    });
  }

  private handleNewMessage(message: Message): void {
    const newMessage = {
      ...message,
      timestamp: new Date(message.timestamp),
    };

    // Prevent duplicates
    if (!this.currentMessages.find((m) => m.id === newMessage.id)) {
      this.currentMessages = [...this.currentMessages, newMessage];
      this.messagesSubject.next(this.currentMessages);
    }
  }

  sendMessage(text: string, senderName: string): Observable<Message> {
    const message = {
      text,
      senderName,
      timestamp: new Date(),
    };

    return this.http.post<Message>(this.apiUrl, message);
  }

  getMessages(): Observable<Message[]> {
    return this.messages$;
  }
}
