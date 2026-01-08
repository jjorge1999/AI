import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

export interface DialogConfig {
  title?: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error' | 'confirm';
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
}

export interface DialogState {
  isOpen: boolean;
  config: DialogConfig | null;
  subject: Subject<boolean> | null;
}

@Injectable({
  providedIn: 'root',
})
export class DialogService {
  private dialogSubject = new BehaviorSubject<DialogState>({
    isOpen: false,
    config: null,
    subject: null,
  });

  public dialog$ = this.dialogSubject.asObservable();
  private dialogQueue: Array<{
    config: DialogConfig;
    subject: Subject<boolean>;
  }> = [];

  alert(
    message: string,
    title?: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info'
  ): Observable<boolean> {
    const subject = new Subject<boolean>();
    const config: DialogConfig = {
      title: title || this.getDefaultTitle(type),
      message,
      type,
      confirmText: 'OK',
      showCancel: false,
    };
    this.enqueueDialog(config, subject);
    return subject.asObservable();
  }

  confirm(
    message: string,
    title?: string,
    confirmText = 'Confirm',
    cancelText = 'Cancel'
  ): Observable<boolean> {
    const subject = new Subject<boolean>();
    const config: DialogConfig = {
      title: title || 'Confirm',
      message,
      type: 'confirm',
      confirmText,
      cancelText,
      showCancel: true,
    };
    this.enqueueDialog(config, subject);
    return subject.asObservable();
  }

  success(message: string, title?: string): Observable<boolean> {
    return this.alert(message, title, 'success');
  }

  error(message: string, title?: string): Observable<boolean> {
    return this.alert(message, title, 'error');
  }

  warning(message: string, title?: string): Observable<boolean> {
    return this.alert(message, title, 'warning');
  }

  info(message: string, title?: string): Observable<boolean> {
    return this.alert(message, title, 'info');
  }

  private enqueueDialog(config: DialogConfig, subject: Subject<boolean>) {
    this.dialogQueue.push({ config, subject });
    this.processQueue();
  }

  private processQueue() {
    const currentState = this.dialogSubject.value;
    // If a dialog is already open, wait.
    if (currentState.isOpen) {
      return;
    }

    const next = this.dialogQueue.shift();
    if (next) {
      this.dialogSubject.next({
        isOpen: true,
        config: next.config,
        subject: next.subject,
      });
    }
  }

  close(result: boolean): void {
    const current = this.dialogSubject.value;
    if (current.subject) {
      current.subject.next(result);
      current.subject.complete();
    }
    // Close current
    this.dialogSubject.next({
      isOpen: false,
      config: null,
      subject: null,
    });
    // Try to open next
    this.processQueue();
  }

  private getDefaultTitle(type: string): string {
    switch (type) {
      case 'success':
        return 'Success';
      case 'error':
        return 'Error';
      case 'warning':
        return 'Warning';
      case 'info':
      default:
        return 'Information';
    }
  }
}
