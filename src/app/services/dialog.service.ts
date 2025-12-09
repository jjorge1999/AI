import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

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
  resolve: ((value: boolean) => void) | null;
}

@Injectable({
  providedIn: 'root',
})
export class DialogService {
  private dialogSubject = new BehaviorSubject<DialogState>({
    isOpen: false,
    config: null,
    resolve: null,
  });

  public dialog$ = this.dialogSubject.asObservable();
  private dialogQueue: Array<{
    config: DialogConfig;
    resolve: (value: boolean) => void;
  }> = [];

  alert(
    message: string,
    title?: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info'
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const config: DialogConfig = {
        title: title || this.getDefaultTitle(type),
        message,
        type,
        confirmText: 'OK',
        showCancel: false,
      };
      this.enqueueDialog(config, resolve);
    });
  }

  confirm(message: string, title?: string): Promise<boolean> {
    return new Promise((resolve) => {
      const config: DialogConfig = {
        title: title || 'Confirm',
        message,
        type: 'confirm',
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        showCancel: true,
      };
      this.enqueueDialog(config, resolve);
    });
  }

  success(message: string, title?: string): Promise<boolean> {
    return this.alert(message, title, 'success');
  }

  error(message: string, title?: string): Promise<boolean> {
    return this.alert(message, title, 'error');
  }

  warning(message: string, title?: string): Promise<boolean> {
    return this.alert(message, title, 'warning');
  }

  info(message: string, title?: string): Promise<boolean> {
    return this.alert(message, title, 'info');
  }

  private enqueueDialog(
    config: DialogConfig,
    resolve: (value: boolean) => void
  ) {
    this.dialogQueue.push({ config, resolve });
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
        resolve: next.resolve,
      });
    }
  }

  close(result: boolean): void {
    const current = this.dialogSubject.value;
    if (current.resolve) {
      current.resolve(result);
    }
    // Close current
    this.dialogSubject.next({
      isOpen: false,
      config: null,
      resolve: null,
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
