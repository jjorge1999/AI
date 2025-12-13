import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LoggingService } from '../../services/logging.service';
import { DialogService } from '../../services/dialog.service';
import { ActivityLog } from '../../models/inventory.models';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-activity-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './activity-logs.component.html',
  styleUrl: './activity-logs.component.css',
})
export class ActivityLogsComponent implements OnInit, OnDestroy {
  logs: ActivityLog[] = [];
  filteredLogs: ActivityLog[] = [];
  private subscriptions: Subscription = new Subscription();

  // Search and Filters
  searchQuery = '';
  selectedEntityType: string = 'all';
  selectedAction: string = 'all';

  // Pagination
  currentPage = 1;
  pageSize = 10;
  pageSizeOptions = [10, 25, 50, 100];

  entityTypes = ['all', 'product', 'sale', 'expense', 'customer'];
  actions = ['all', 'create', 'update', 'delete', 'restock', 'complete'];

  constructor(
    private loggingService: LoggingService,
    private dialogService: DialogService
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.loggingService.getLogs().subscribe((logs) => {
        this.logs = logs.map((log) => ({
          ...log,
          timestamp: new Date(
            (log.timestamp as any)?._seconds * 1000 || new Date()
          ),
        }));
        this.applyFilters();
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  applyFilters(): void {
    this.filteredLogs = this.logs.filter((log) => {
      const matchesEntity =
        this.selectedEntityType === 'all' ||
        log.entityType === this.selectedEntityType;
      const matchesAction =
        this.selectedAction === 'all' || log.action === this.selectedAction;

      let matchesSearch = true;
      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase();
        matchesSearch = !!(
          log.entityId?.toLowerCase().includes(query) ||
          log.entityType?.toLowerCase().includes(query) ||
          log.action?.toLowerCase().includes(query) ||
          (log.details &&
            JSON.stringify(log.details).toLowerCase().includes(query))
        );
      }

      return matchesEntity && matchesAction && matchesSearch;
    });
    this.currentPage = 1;
  }

  onSearchChange(): void {
    this.applyFilters();
  }

  onFilterChange(): void {
    this.applyFilters();
  }

  get paginatedLogs(): ActivityLog[] {
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    return this.filteredLogs.slice(start, end);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredLogs.length / this.pageSize) || 1;
  }

  get showingFrom(): number {
    return this.filteredLogs.length > 0
      ? (this.currentPage - 1) * this.pageSize + 1
      : 0;
  }

  get showingTo(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredLogs.length);
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

  goToPage(page: number): void {
    this.currentPage = page;
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const total = this.totalPages;
    const current = this.currentPage;

    if (total <= 5) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      if (current <= 3) {
        pages.push(1, 2, 3, -1, total);
      } else if (current >= total - 2) {
        pages.push(1, -1, total - 2, total - 1, total);
      } else {
        pages.push(1, -1, current, -2, total);
      }
    }
    return pages;
  }

  refreshLogs(): void {
    this.loggingService.refreshLogs();
  }

  cleanupOldLogs(): void {
    this.dialogService
      .confirm(
        'This will delete all logs older than 30 days. Continue?',
        'Cleanup Logs'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.subscriptions.add(
            this.loggingService.cleanupOldLogs().subscribe({
              next: (result) => {
                this.dialogService
                  .success(
                    `Cleanup completed! Deleted ${result.deletedCount} logs.`
                  )
                  .subscribe();
                this.refreshLogs();
              },
              error: (err) => {
                console.error('Cleanup error:', err);
                this.dialogService.error('Failed to cleanup logs').subscribe();
              },
            })
          );
        }
      });
  }

  // Material icon mappings
  getActionIcon(action: string): string {
    const icons: { [key: string]: string } = {
      create: 'add_circle',
      update: 'edit',
      delete: 'delete',
      restock: 'inventory',
      complete: 'check_circle',
      login: 'login',
    };
    return icons[action] || 'article';
  }

  getActionColor(action: string): string {
    const colors: { [key: string]: string } = {
      create: 'green',
      update: 'blue',
      delete: 'red',
      restock: 'blue',
      complete: 'green',
      login: 'amber',
    };
    return colors[action] || 'gray';
  }

  getEntityIcon(entityType: string): string {
    const icons: { [key: string]: string } = {
      product: 'inventory_2',
      sale: 'receipt_long',
      expense: 'payments',
      customer: 'person',
    };
    return icons[entityType] || 'description';
  }

  formatTimestamp(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  getLogDetails(log: ActivityLog): string {
    if (!log.details) return '';

    if (typeof log.details === 'string') return log.details;

    // Extract meaningful info from details object
    const details = log.details as any;
    if (details.productName) return details.productName;
    if (details.name) return details.name;
    if (details.quantity) return `Qty: ${details.quantity}`;

    return '';
  }

  getUserInitials(log: ActivityLog): string {
    // Use entityType as fallback for user display
    const name = log.entityType || 'U';
    return name.charAt(0).toUpperCase();
  }

  exportLogs(): void {
    // Create CSV content
    const headers = ['Timestamp', 'Action', 'Module', 'Entity ID', 'Details'];
    const rows = this.filteredLogs.map((log) => [
      this.formatTimestamp(log.timestamp),
      log.action,
      log.entityType,
      log.entityId,
      this.getLogDetails(log),
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}
