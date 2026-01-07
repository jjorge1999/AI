import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { ActivityLog } from '../models/inventory.models';
import { environment } from '../../environments/environment';
import { StoreService } from './store.service';

@Injectable({
  providedIn: 'root',
})
export class LoggingService {
  private apiUrl = environment.apiUrl;
  private logsSubject = new BehaviorSubject<ActivityLog[]>([]);
  public logs$ = this.logsSubject.asObservable();

  constructor(private http: HttpClient, private storeService: StoreService) {
    // Removed automatic fetch on instantiation
  }

  private getCurrentUserId(): string {
    return localStorage.getItem('jjm_user_id') || 'guest';
  }

  private fetchLogs(): void {
    const userId = this.getCurrentUserId();
    const storeId = this.storeService.getActiveStoreId();

    // Security: Do not fetch for unauthenticated users or without store context
    if (!userId || userId === 'guest' || !storeId) {
      if (!storeId) this.logsSubject.next([]);
      return;
    }

    const url = `${this.apiUrl}/logs?limit=200&userId=${userId}&storeId=${storeId}`;

    this.http.get<ActivityLog[]>(url).subscribe({
      next: (logs) => this.logsSubject.next(logs),
      error: (err) => console.error('Error fetching logs:', err),
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

    const logData = {
      action,
      entityType,
      entityId,
      entityName,
      details,
      userId: this.getCurrentUserId(),
      storeId: activeStoreId,
    };

    console.log('Logging activity:', logData);

    this.http.post<ActivityLog>(`${this.apiUrl}/logs`, logData).subscribe({
      next: (newLog) => {
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
    return this.http.post(`${this.apiUrl}/cleanup-logs`, {});
  }
}
