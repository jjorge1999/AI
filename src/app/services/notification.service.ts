import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';
import { StoreService } from './store.service';
import {
  getMessaging,
  getToken,
  onMessage,
  Messaging,
} from 'firebase/messaging';
import { environment } from '../../environments/environment';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
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
  storeId?: string; // Store-specific notifications
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
  private activeStoreId: string | null = null;
  private storeSubscription: Subscription | null = null;
  private hasInitialized = false;

  constructor(
    private firebaseService: FirebaseService,
    private storeService: StoreService
  ) {
    this.db = this.firebaseService.db;
    this.messaging = getMessaging(this.firebaseService.app);

    // Migrate old notifications to clear the non-store-specific key
    this.migrateOldNotifications();

    // Subscribe to active store changes
    this.storeSubscription = this.storeService.activeStoreId$.subscribe(
      (storeId) => {
        const storeChanged = storeId !== this.activeStoreId;
        this.activeStoreId = storeId;

        // Always load on first subscription or when store changes
        if (!this.hasInitialized || storeChanged) {
          this.hasInitialized = true;
          this.loadPersistedNotifications();
        }
      }
    );
  }

  private migrateOldNotifications(): void {
    // Clear old non-store-specific notifications to prevent cross-store leakage
    const oldKey = 'jjm_admin_notifications';
    if (localStorage.getItem(oldKey)) {
      localStorage.removeItem(oldKey);
      console.log(
        'NotificationService: Cleared old non-store-specific notifications'
      );
    }
  }

  private getStorageKey(): string {
    return this.activeStoreId
      ? `jjm_admin_notifications_${this.activeStoreId}`
      : 'jjm_admin_notifications';
  }

  private loadPersistedNotifications() {
    const saved = localStorage.getItem(this.getStorageKey());
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
        this.notificationsSubject.next([]);
        this.notificationCountSubject.next(0);
      }
    } else {
      this.notificationsSubject.next([]);
      this.notificationCountSubject.next(0);
    }
  }

  private persistNotifications() {
    localStorage.setItem(
      this.getStorageKey(),
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

      // Extract storeId from payload data if available
      const storeId = payload.data?.storeId;

      this.pushNotification(
        payload.notification?.title || 'New Notification',
        payload.notification?.body || '',
        this.determineType(payload),
        storeId
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

  /**
   * Push a notification to the current active store
   * @param title Notification title
   * @param body Notification body
   * @param type Notification type
   * @param targetStoreId Optional: If provided, only adds notification if it matches the active store
   */
  public pushNotification(
    title: string,
    body: string,
    type: AdminNotification['type'] = 'system',
    targetStoreId?: string
  ): boolean {
    console.log(
      `NotificationService: Pushing "${title}" for store: ${
        targetStoreId || this.activeStoreId || 'all'
      }`
    );

    // If targetStoreId is specified, only add if it matches current active store
    if (targetStoreId && targetStoreId !== this.activeStoreId) {
      console.log(
        `NotificationService: Skipping - notification is for store ${targetStoreId}, but active store is ${this.activeStoreId}`
      );
      // Save to the target store's storage instead
      this.saveNotificationToStore(title, body, type, targetStoreId);
      return false;
    }

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
      storeId: targetStoreId || this.activeStoreId || undefined,
    };
    this.addNotification(notification);
    console.log('NotificationService: Notification added successfully.');
    return true;
  }

  /**
   * Save notification directly to a specific store's storage (for when user is viewing a different store)
   */
  private saveNotificationToStore(
    title: string,
    body: string,
    type: AdminNotification['type'],
    storeId: string
  ): void {
    const storageKey = `jjm_admin_notifications_${storeId}`;
    let notifications: AdminNotification[] = [];

    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        notifications = JSON.parse(saved).map((n: any) => ({
          ...n,
          timestamp: new Date(n.timestamp),
        }));
      } catch (e) {
        console.error(
          'Failed to parse stored notifications for store',
          storeId
        );
      }
    }

    // Check for duplicates
    const exists = notifications.some(
      (n) => n.title === title && n.body === body
    );
    if (exists) return;

    const notification: AdminNotification = {
      id: Date.now().toString(),
      title,
      body,
      timestamp: new Date(),
      type,
      read: false,
      storeId,
    };

    notifications = [notification, ...notifications].slice(0, 15);
    localStorage.setItem(storageKey, JSON.stringify(notifications));
    console.log(
      `NotificationService: Saved notification to store ${storeId} storage`
    );
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
