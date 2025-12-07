import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogService, DialogState } from '../../services/dialog.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dialog.component.html',
  styleUrl: './dialog.component.css',
})
export class DialogComponent implements OnInit, OnDestroy {
  dialogState: DialogState = {
    isOpen: false,
    config: null,
    resolve: null,
  };

  private subscription?: Subscription;

  constructor(private dialogService: DialogService) {}

  ngOnInit(): void {
    this.subscription = this.dialogService.dialog$.subscribe((state) => {
      this.dialogState = state;
    });
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  onConfirm(): void {
    this.dialogService.close(true);
  }

  onCancel(): void {
    this.dialogService.close(false);
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onCancel();
    }
  }

  getIcon(): string {
    switch (this.dialogState.config?.type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'confirm':
        return '❓';
      case 'info':
      default:
        return 'ℹ️';
    }
  }
}
