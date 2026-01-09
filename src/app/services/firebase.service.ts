import { Injectable } from '@angular/core';
import { FirebaseApp, getApp } from 'firebase/app';
import {
  Firestore,
  getFirestore,
  enableIndexedDbPersistence,
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
      if (err.code == 'failed-precondition') {
        console.warn(
          'Multiple tabs open, persistence can only be enabled in one tab at a time.'
        );
      } else if (err.code == 'unimplemented') {
        console.warn(
          'The current browser does not support all of the features required to enable persistence'
        );
      }
    });
  }
}
