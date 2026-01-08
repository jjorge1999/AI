import { Injectable } from '@angular/core';
import { FirebaseApp, getApp } from 'firebase/app';
import { Firestore, getFirestore } from 'firebase/firestore';

@Injectable({
  providedIn: 'root',
})
export class FirebaseService {
  public app: FirebaseApp;
  public db: Firestore;

  constructor() {
    this.app = getApp();
    this.db = getFirestore(this.app);
  }
}
