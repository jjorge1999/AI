import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LoggingService } from '../../services/logging.service';
import { ActivityLog } from '../../models/inventory.models';

@Component({
  selector: 'app-activity-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './activity-logs.component.html',
  styleUrl: './activity-logs.component.css',
})
export class ActivityLogsComponent implements OnInit {
  logs: ActivityLog[] = [];
  filteredLogs: ActivityLog[] = [];

  // Filters
  selectedEntityType: string = 'all';
  selectedAction: string = 'all';

  // Pagination
  currentPage = 1;
  pageSize = 20;

  entityTypes = ['all', 'product', 'sale', 'expense', 'customer'];
  actions = ['all', 'create', 'update', 'delete', 'restock', 'complete'];

  constructor(private loggingService: LoggingService) {}

  ngOnInit(): void {
    this.loggingService.getLogs().subscribe((logs) => {
      this.logs = logs.map((log) => ({
        ...log,
        timestamp: new Date((log.timestamp as any)?._seconds * 1000),
      }));
      this.applyFilters();
    });
  }

  applyFilters(): void {
    this.filteredLogs = this.logs.filter((log) => {
      const matchesEntity =
        this.selectedEntityType === 'all' ||
        log.entityType === this.selectedEntityType;
      const matchesAction =
        this.selectedAction === 'all' || log.action === this.selectedAction;
      return matchesEntity && matchesAction;
    });
    this.currentPage = 1;
  }

  get paginatedLogs(): ActivityLog[] {
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    return this.filteredLogs.slice(start, end);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredLogs.length / this.pageSize);
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  prevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  refreshLogs(): void {
    this.loggingService.refreshLogs();
  }

  cleanupOldLogs(): void {
    if (confirm('This will delete all logs older than 30 days. Continue?')) {
      this.loggingService.cleanupOldLogs().subscribe({
        next: (result) => {
          alert(`Cleanup completed! Deleted ${result.deletedCount} logs.`);
          this.refreshLogs();
        },
        error: (err) => {
          console.error('Cleanup error:', err);
          alert('Failed to cleanup logs');
        },
      });
    }
  }

  getActionIcon(action: string): string {
    const icons: { [key: string]: string } = {
      create: '➕',
      update: '✏️',
      delete: '🗑️',
      restock: '📦',
      complete: '✅',
    };
    return icons[action] || '📝';
  }

  getEntityIcon(entityType: string): string {
    const icons: { [key: string]: string } = {
      product: '📦',
      sale: '💰',
      expense: '💸',
      customer: '👤',
    };
    return icons[entityType] || '📄';
  }
}
