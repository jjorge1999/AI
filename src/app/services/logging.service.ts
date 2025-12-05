import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { ActivityLog } from '../models/inventory.models';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class LoggingService {
  private apiUrl = environment.apiUrl;
  private logsSubject = new BehaviorSubject<ActivityLog[]>([]);
  public logs$ = this.logsSubject.asObservable();

  constructor(private http: HttpClient) {
    this.fetchLogs();
  }

  private getCurrentUserId(): string {
    return localStorage.getItem('jjm_user_id') || 'guest';
  }

  private fetchLogs(): void {
    const userId = this.getCurrentUserId();
    this.http
      .get<ActivityLog[]>(`${this.apiUrl}/logs?limit=200&userId=${userId}`)
      .subscribe({
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
    const logData = {
      action,
      entityType,
      entityId,
      entityName,
      details,
      userId: this.getCurrentUserId(),
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
