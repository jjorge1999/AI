import { Injectable } from '@angular/core';
import { FirebaseApp, getApp } from 'firebase/app';
import {
  Firestore,
  getFirestore,
  enableIndexedDbPersistence,
  disableNetwork,
} from 'firebase/firestore';

@Injectable({
  providedIn: 'root',
})
export class FirebaseService {
  public app: FirebaseApp;
  public db: Firestore;

  constructor() {
    this.app = getApp();
    this.db = getFirestore(this.app);

    enableIndexedDbPersistence(this.db).catch((err) => {
      console.warn('Firebase Persistence Error:', err.code);
    });

    // TRUE OFFLINE: If Data Saver is ON, disable network immediately at the source
    if (localStorage.getItem('jjm_data_saver_mode') === 'true') {
      console.warn(
        'FirebaseService: Data Saver Mode detected on startup. Disabling network.'
      );
      disableNetwork(this.db).catch((err) =>
        console.error('Failed to disable network on startup', err)
      );
    }
  }
}
