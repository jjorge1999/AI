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

  alert(
    message: string,
    title?: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info'
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.dialogSubject.next({
        isOpen: true,
        config: {
          title: title || this.getDefaultTitle(type),
          message,
          type,
          confirmText: 'OK',
          showCancel: false,
        },
        resolve,
      });
    });
  }

  confirm(message: string, title?: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.dialogSubject.next({
        isOpen: true,
        config: {
          title: title || 'Confirm',
          message,
          type: 'confirm',
          confirmText: 'Confirm',
          cancelText: 'Cancel',
          showCancel: true,
        },
        resolve,
      });
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

  close(result: boolean): void {
    const current = this.dialogSubject.value;
    if (current.resolve) {
      current.resolve(result);
    }
    this.dialogSubject.next({
      isOpen: false,
      config: null,
      resolve: null,
    });
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
