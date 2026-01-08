import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MaintenanceService {
  private maintenanceModeSubject = new BehaviorSubject<boolean>(false);
  public isMaintenanceMode$ = this.maintenanceModeSubject.asObservable();

  private maintenanceMessageSubject = new BehaviorSubject<string>(
    'System is currently undergoing maintenance. Please try again later.'
  );
  public maintenanceMessage$ = this.maintenanceMessageSubject.asObservable();

  setMaintenanceMode(active: boolean, message?: string): void {
    if (message) {
      this.maintenanceMessageSubject.next(message);
    }
    this.maintenanceModeSubject.next(active);

    if (active) {
      console.warn('Maintenance Mode Activated:', message || 'No message');
    }
  }

  isMaintenanceMode(): boolean {
    return this.maintenanceModeSubject.value;
  }
}
