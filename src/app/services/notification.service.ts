import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';
import {
  getMessaging,
  getToken,
  onMessage,
  Messaging,
} from 'firebase/messaging';
import { environment } from '../../environments/environment';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  doc,
  updateDoc,
  Firestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  arrayUnion,
} from 'firebase/firestore';

export interface AdminNotification {
  id: string;
  title: string;
  body: string;
  timestamp: Date;
  type: 'message' | 'reservation' | 'delivery' | 'system' | 'reminder';
  read: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private messaging: Messaging;
  private currentTokenSubject = new BehaviorSubject<string | null>(null);
  public currentToken$ = this.currentTokenSubject.asObservable();

  private notificationCountSubject = new BehaviorSubject<number>(0);
  public notificationCount$ = this.notificationCountSubject.asObservable();

  private notificationsSubject = new BehaviorSubject<AdminNotification[]>([]);
  public notifications$ = this.notificationsSubject.asObservable();

  private db: Firestore;

  constructor(private firebaseService: FirebaseService) {
    this.db = this.firebaseService.db;
    this.messaging = getMessaging(this.firebaseService.app);
    this.loadPersistedNotifications();
  }

  private loadPersistedNotifications() {
    const saved = localStorage.getItem('jjm_admin_notifications');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Convert string dates back to Date objects
        const formatted = parsed.map((n: any) => ({
          ...n,
          timestamp: new Date(n.timestamp),
        }));
        this.notificationsSubject.next(formatted);

        // Recalculate unread count
        const unreadCount = formatted.filter((n: any) => !n.read).length;
        this.notificationCountSubject.next(unreadCount);
      } catch (e) {
        console.error('Failed to load persisted notifications', e);
      }
    }
  }

  private persistNotifications() {
    localStorage.setItem(
      'jjm_admin_notifications',
      JSON.stringify(this.notificationsSubject.value)
    );
  }

  async requestPermission() {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        console.log('Notification permission granted.');
        await this.saveToken();
      } else {
        console.warn('Notification permission denied.');
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
    }
  }

  async saveToken() {
    try {
      const token = await getToken(this.messaging, {
        vapidKey:
          'BGs-QyMYgOwh4Tou3a2TkUcwX2twiK6QJYhF2mg4Sfv1BJo6pGcpN5pG8d02Tl7uLQPVGKTJhqwWIgS7Ehh5HeA', // Standard demo key or real one if available
      });

      if (token) {
        console.log('FCM Token:', token);
        this.currentTokenSubject.next(token);

        const userId = localStorage.getItem('jjm_user_id');
        if (userId) {
          // Update Firestore Directly (optional, kept for redundancy)
          const userRef = doc(this.db, 'users', userId);
          await updateDoc(userRef, {
            fcmTokens: arrayUnion(token),
          }).catch(() =>
            console.log('Firestore direct update failed, will use backend API.')
          );

          // Call Backend API to save token
          const apiUrl = environment.apiUrl;
          try {
            await fetch(`${apiUrl}/fcm-token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, token }),
            });
            console.log('Token saved to backend successfully');
          } catch (apiError) {
            console.error('Failed to save token to backend:', apiError);
          }
        }
      } else {
        console.log(
          'No registration token available. Request permission to generate one.'
        );
      }
    } catch (err) {
      console.error('An error occurred while retrieving token. ', err);
    }
  }

  listenForMessages() {
    onMessage(this.messaging, (payload: any) => {
      console.log('Message received in foreground: ', payload);

      this.pushNotification(
        payload.notification?.title || 'New Notification',
        payload.notification?.body || '',
        this.determineType(payload)
      );

      // Show as a browser notification if possible
      if (payload.notification) {
        new Notification(payload.notification.title || 'New Notification', {
          body: payload.notification.body || '',
          icon: '/assets/icons/icon-72x72.png',
        });
      }
    });
  }

  private determineType(payload: any): AdminNotification['type'] {
    const data = payload.data || {};
    if (data.type === 'chat_message') return 'message';
    if (data.type === 'new_reservation') return 'reservation';
    if (data.type === 'delivery_update') return 'delivery';
    if (data.type === 'delivery_reminder') return 'reminder';
    return 'system';
  }

  public pushNotification(
    title: string,
    body: string,
    type: AdminNotification['type'] = 'system'
  ): boolean {
    console.log(`NotificationService: Pushing "${title}"`);
    // Deduplication: Avoid adding exact same notification if it already exists
    const exists = this.notificationsSubject.value.some(
      (n) => n.title === title && n.body === body
    );
    if (exists) {
      console.log(
        `NotificationService: "${title}" already exists, skipping duplicate.`
      );
      return false;
    }

    const notification: AdminNotification = {
      id: Date.now().toString(),
      title,
      body,
      timestamp: new Date(),
      type,
      read: false,
    };
    this.addNotification(notification);
    console.log('NotificationService: Notification added successfully.');
    return true;
  }

  private addNotification(notif: AdminNotification) {
    const current = this.notificationsSubject.value;
    const updated = [notif, ...current].slice(0, 15); // Keep last 15
    this.notificationsSubject.next(updated);
    this.notificationCountSubject.next(this.notificationCountSubject.value + 1);
    this.persistNotifications();
  }

  resetNotificationCount() {
    this.notificationCountSubject.next(0);
    const updated = this.notificationsSubject.value.map((n) => ({
      ...n,
      read: true,
    }));
    this.notificationsSubject.next(updated);
    this.persistNotifications();
  }

  clearNotifications() {
    this.notificationsSubject.next([]);
    this.notificationCountSubject.next(0);
    this.persistNotifications();
  }
}
