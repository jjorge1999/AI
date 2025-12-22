import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { InventoryService } from '../../services/inventory.service';
import { DialogService } from '../../services/dialog.service';
import { Expense } from '../../models/inventory.models';
import { DeviceService } from '../../services/device.service';

interface ExpenseStats {
  totalSpend: number;
  topCategory: string;
  topCategoryAmount: number;
  expenseCount: number;
}

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './expenses.component.html',
  styleUrl: './expenses.component.css',
})
export class ExpensesComponent implements OnInit, OnDestroy {
  expenses: Expense[] = [];
  viewMode: 'table' | 'grid' = 'table';
  private subscriptions: Subscription[] = [];

  // Search and filtering
  searchQuery = '';
  categoryFilter = '';
  categories: string[] = [
    'Supplies',
    'Utilities',
    'Equipment',
    'Travel',
    'Meals',
    'Office',
    'Other',
  ];

  // Modal state
  showAddModal = false;
  isEditMode = false;
  editingId: string | null = null;

  // Form fields
  expense = {
    productName: '',
    price: 0,
    notes: '',
    category: '',
  };

  // Pagination
  currentPage = 1;
  pageSize = 10;
  pageSizeOptions = [5, 10, 20, 50];

  constructor(
    private inventoryService: InventoryService,
    private dialogService: DialogService,
    private deviceService: DeviceService
  ) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.inventoryService.getExpenses().subscribe((expenses) => {
        this.expenses = expenses.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      })
    );

    // Auto-switch to grid view on mobile
    this.subscriptions.push(
      this.deviceService.isMobile$.subscribe((isMobile) => {
        if (isMobile) {
          this.viewMode = 'grid';
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  // Stats calculation
  get stats(): ExpenseStats {
    const total = this.expenses.reduce((sum, e) => sum + e.price, 0);

    // Calculate top category
    const categoryTotals: { [key: string]: number } = {};
    this.expenses.forEach((e) => {
      const cat = (e as any).category || 'Other';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + e.price;
    });

    let topCategory = 'None';
    let topAmount = 0;
    Object.entries(categoryTotals).forEach(([cat, amount]) => {
      if (amount > topAmount) {
        topCategory = cat;
        topAmount = amount;
      }
    });

    return {
      totalSpend: total,
      topCategory,
      topCategoryAmount: topAmount,
      expenseCount: this.expenses.length,
    };
  }

  get monthlyTotal(): number {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.expenses
      .filter((e) => new Date(e.timestamp) >= startOfMonth)
      .reduce((sum, e) => sum + e.price, 0);
  }

  // Filtering
  get filteredExpenses(): Expense[] {
    let result = [...this.expenses];

    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.productName.toLowerCase().includes(query) ||
          e.notes?.toLowerCase().includes(query)
      );
    }

    if (this.categoryFilter) {
      result = result.filter(
        (e) => (e as any).category === this.categoryFilter
      );
    }

    return result;
  }

  get paginatedExpenses(): Expense[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    return this.filteredExpenses.slice(startIndex, startIndex + this.pageSize);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredExpenses.length / this.pageSize) || 1;
  }

  // Modal controls
  openAddModal(): void {
    this.isEditMode = false;
    this.editingId = null;
    this.resetForm();
    this.showAddModal = true;
  }

  openEditModal(exp: Expense): void {
    this.isEditMode = true;
    this.editingId = exp.id;
    this.expense = {
      productName: exp.productName,
      price: exp.price,
      notes: exp.notes || '',
      category: (exp as any).category || '',
    };
    this.showAddModal = true;
  }

  closeModal(): void {
    this.showAddModal = false;
    this.resetForm();
  }

  resetForm(): void {
    this.expense = {
      productName: '',
      price: 0,
      notes: '',
      category: '',
    };
    this.editingId = null;
    this.isEditMode = false;
  }

  // Form actions
  onSubmit(): void {
    if (this.isValid()) {
      if (this.isEditMode && this.editingId) {
        // Update existing expense (would need updateExpense method in service)
        // For now, just close modal
        this.closeModal();
      } else {
        this.inventoryService
          .addExpense({
            productName: this.expense.productName,
            price: this.expense.price,
            notes: this.expense.notes,
          })
          .subscribe();
        this.closeModal();
      }
    }
  }

  isValid(): boolean {
    return !!(this.expense.productName && this.expense.price > 0);
  }

  deleteExpense(expense: Expense): void {
    this.dialogService
      .confirm(
        `Are you sure you want to delete "${
          expense.productName
        }" (${this.formatCurrency(expense.price)})?`,
        'Delete Expense'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.inventoryService.deleteExpense(expense.id).subscribe();
        }
      });
  }

  // Pagination
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
    return Array(this.totalPages)
      .fill(0)
      .map((x, i) => i + 1);
  }

  onSearchChange(): void {
    this.currentPage = 1;
  }

  onFilterChange(category: string): void {
    this.categoryFilter = this.categoryFilter === category ? '' : category;
    this.currentPage = 1;
  }

  // Helpers
  get showingFrom(): number {
    return this.filteredExpenses.length > 0
      ? (this.currentPage - 1) * this.pageSize + 1
      : 0;
  }

  get showingTo(): number {
    return Math.min(
      this.currentPage * this.pageSize,
      this.filteredExpenses.length
    );
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  getMerchantInitials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  getCategoryColor(category: string): string {
    const colors: { [key: string]: string } = {
      Supplies: 'blue',
      Utilities: 'purple',
      Equipment: 'gray',
      Travel: 'purple',
      Meals: 'yellow',
      Office: 'teal',
      Other: 'gray',
    };
    return colors[category] || 'gray';
  }
}
