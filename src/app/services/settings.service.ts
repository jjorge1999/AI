import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { BehaviorSubject, Observable, from, tap } from 'rxjs';
import { map } from 'rxjs/operators';

export interface AppSettings {
  huggingFaceToken?: string;
  gemmaEnabled?: boolean;
  updatedAt?: Date;
  updatedBy?: string;
}

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private db;
  private settingsDoc = 'app_settings';
  private settingsSubject = new BehaviorSubject<AppSettings>({});
  public settings$ = this.settingsSubject.asObservable();
  private unsubscribe: Unsubscribe | null = null;

  constructor(private firebaseService: FirebaseService) {
    this.db = this.firebaseService.db;
    this.loadSettings();
  }

  private loadSettings(): void {
    const settingsRef = doc(this.db, 'settings', this.settingsDoc);

    // Listen for realtime updates
    this.unsubscribe = onSnapshot(
      settingsRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as AppSettings;
          this.settingsSubject.next(data);

          // Also cache to localStorage for offline access
          if (data.huggingFaceToken) {
            localStorage.setItem('hf_token', data.huggingFaceToken);
          }
        } else {
          // Initialize empty settings doc
          this.settingsSubject.next({});
        }
      },
      (error) => {
        console.warn('Settings listener error:', error);
        // Try to load from localStorage as fallback
        const cachedToken = localStorage.getItem('hf_token');
        if (cachedToken) {
          this.settingsSubject.next({ huggingFaceToken: cachedToken });
        }
      }
    );
  }

  saveHuggingFaceToken(token: string): Observable<void> {
    const settingsRef = doc(this.db, 'settings', this.settingsDoc);
    const userId = localStorage.getItem('jjm_user_id') || 'admin';

    return from(
      setDoc(
        settingsRef,
        {
          huggingFaceToken: token,
          gemmaEnabled: true,
          updatedAt: new Date(),
          updatedBy: userId,
        },
        { merge: true }
      )
    ).pipe(
      tap({
        next: () => {
          localStorage.setItem('hf_token', token);
          console.log('Settings: Hugging Face token saved to database');
        },
        error: (error) => {
          console.error('Settings: Error saving token to database:', error);
          localStorage.setItem('hf_token', token);
        },
      }),
      map(() => void 0)
    );
  }

  clearHuggingFaceToken(): Observable<void> {
    const settingsRef = doc(this.db, 'settings', this.settingsDoc);
    const userId = localStorage.getItem('jjm_user_id') || 'admin';

    return from(
      setDoc(
        settingsRef,
        {
          huggingFaceToken: '',
          gemmaEnabled: false,
          updatedAt: new Date(),
          updatedBy: userId,
        },
        { merge: true }
      )
    ).pipe(
      tap({
        next: () => {
          console.log('Settings: Hugging Face token cleared from database');
        },
        error: (error) => {
          console.error('Settings: Error clearing token from database:', error);
        },
      }),
      map(() => void 0)
    );
  }

  getSettings(): Observable<AppSettings> {
    return this.settings$;
  }

  getHuggingFaceToken(): string | null {
    const settings = this.settingsSubject.value;
    return settings.huggingFaceToken || localStorage.getItem('hf_token');
  }

  isGemmaConfigured(): boolean {
    const token = this.getHuggingFaceToken();
    return !!token && token.startsWith('hf_');
  }

  ngOnDestroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}
