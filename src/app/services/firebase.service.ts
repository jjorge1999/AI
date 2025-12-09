import { Injectable } from '@angular/core';
import { initializeApp, FirebaseApp, getApp, getApps } from 'firebase/app';
import {
  initializeFirestore,
  Firestore,
  getFirestore,
} from 'firebase/firestore';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class FirebaseService {
  public app: FirebaseApp;
  public db: Firestore;

  constructor() {
    // Check if app already initialized to avoid errors
    if (getApps().length > 0) {
      this.app = getApp();
      // Try to get existing Firestore or initialize if needed
      this.db = getFirestore(this.app);
      // Note: If already initialized without long polling, we can't force it here
      // without restarting app logic, but we assume we are the first.
    } else {
      this.app = initializeApp(environment.firebaseConfig);
      // Initialize Firestore with Long Polling settings for reliability
      this.db = initializeFirestore(this.app, {
        experimentalForceLongPolling: true,
      });
    }
  }
}
