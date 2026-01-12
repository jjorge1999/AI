import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ActivityLog } from '../models/inventory.models';
import { StoreService } from './store.service';
import { FirebaseService } from './firebase.service';
import {
  collection,
  getDocs,
  doc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  deleteDoc,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';

@Injectable({
  providedIn: 'root',
})
export class LoggingService {
  private logsSubject = new BehaviorSubject<ActivityLog[]>([]);
  public logs$ = this.logsSubject.asObservable();

  private get db() {
    return this.firebaseService.db;
  }

  constructor(
    private firebaseService: FirebaseService,
    private storeService: StoreService
  ) {
    // Automatically fetch logs when the active store changes
    this.storeService.activeStoreId$.subscribe((storeId) => {
      if (storeId) {
        this.fetchLogs(storeId);
      } else {
        this.logsSubject.next([]);
      }
    });
  }

  private getCurrentUserId(): string {
    return localStorage.getItem('jjm_user_id') || 'guest';
  }

  private fetchLogs(explicitStoreId?: string): void {
    const storeId = explicitStoreId || this.storeService.getActiveStoreId();

    // Security: Fetch logs if we have a valid store context.
    // Auth security is handled by Firestore Rules (request.auth).
    if (!storeId) {
      console.log('LoggingService: No storeId available, skipping fetch.');
      this.logsSubject.next([]);
      return;
    }

    console.log('LoggingService: Fetching logs for storeId:', storeId);

    const logsRef = collection(this.db, 'activityLogs');
    // Note: Removing orderBy('timestamp') to avoid requiring a composite index immediately.
    // We sort client-side for now.
    const q = query(logsRef, where('storeId', '==', storeId), limit(200));

    from(getDocs(q)).subscribe({
      next: (snapshot) => {
        console.log('LoggingService: Received', snapshot.docs.length, 'logs');
        const logs: ActivityLog[] = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              ...data,
              timestamp: data['timestamp']?.toDate
                ? data['timestamp'].toDate()
                : data['timestamp'],
            } as ActivityLog;
          })
          .sort((a, b) => {
            const tA = a.timestamp instanceof Date ? a.timestamp.getTime() : 0;
            const tB = b.timestamp instanceof Date ? b.timestamp.getTime() : 0;
            return tB - tA; // Descending
          });
        this.logsSubject.next(logs);
      },
      error: (err) => {
        console.error('LoggingService: Error fetching logs:', err);
        console.error(
          'LoggingService: This may be a Firestore permissions issue. Check Security Rules for /logs collection.'
        );
      },
    });
  }

  logActivity(
    action: string,
    entityType: string,
    entityId: string,
    entityName: string,
    details?: string
  ): void {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      console.warn('Logging skipped: No active store selected.');
      return;
    }

    const logData: any = {
      action: action || 'unknown',
      entityType: entityType || 'unknown',
      entityId: entityId || '',
      entityName: entityName || '',
      details: details || '',
      userId: this.getCurrentUserId() || 'system',
      storeId: activeStoreId,
      timestamp: new Date(),
    };

    console.log('Logging activity:', logData);

    const logsRef = collection(this.db, 'activityLogs');
    from(addDoc(logsRef, logData)).subscribe({
      next: (docRef) => {
        const newLog: ActivityLog = {
          id: docRef.id,
          ...logData,
        } as ActivityLog;
        console.log('Activity logged successfully:', newLog);
        const currentLogs = this.logsSubject.value;
        this.logsSubject.next([newLog, ...currentLogs]);
      },
      error: (err) => {
        console.error('Error logging activity:', err);
        console.error('Failed log data:', logData);
      },
    });
  }

  getLogs(): Observable<ActivityLog[]> {
    return this.logs$;
  }

  refreshLogs(): void {
    this.fetchLogs();
  }

  cleanupOldLogs(): Observable<any> {
    // Clean up logs older than 30 days
    const userId = this.getCurrentUserId();
    const storeId = this.storeService.getActiveStoreId();

    if (!storeId) {
      return of({ message: 'No store selected' });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const logsRef = collection(this.db, 'activityLogs');
    const q = query(
      logsRef,
      where('storeId', '==', storeId),
      where('timestamp', '<', thirtyDaysAgo)
    );

    return from(getDocs(q)).pipe(
      map(async (snapshot) => {
        const batch = writeBatch(this.db);
        snapshot.docs.forEach((docSnap) => {
          batch.delete(docSnap.ref);
        });
        await batch.commit();
        return { deleted: snapshot.docs.length };
      }),
      catchError((err) => {
        console.error('Error cleaning up logs:', err);
        return of({ error: err.message });
      })
    );
  }
}
