import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { InventoryService } from '../../services/inventory.service';
import { Sale, Expense } from '../../models/inventory.models';

interface MonthlyData {
  month: string;
  income: number;
  expense: number;
}

interface Transaction {
  date: Date;
  description: string;
  category: string;
  type: 'income' | 'expense';
  amount: number;
  status: 'completed' | 'pending';
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.css',
})
export class ReportsComponent implements OnInit, OnDestroy {
  sales: Sale[] = [];
  expenses: Expense[] = [];
  private subscriptions: Subscription[] = [];

  // Date range filter
  dateRange = '30days';
  dateRanges = [
    { value: '7days', label: 'Last 7 Days' },
    { value: '30days', label: 'Last 30 Days' },
    { value: 'quarter', label: 'This Quarter' },
    { value: 'year', label: 'This Year' },
  ];

  constructor(private inventoryService: InventoryService) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.inventoryService.getSales().subscribe((sales) => {
        this.sales = sales;
      })
    );

    this.subscriptions.push(
      this.inventoryService.getExpenses().subscribe((expenses) => {
        this.expenses = expenses;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  setDateRange(range: string): void {
    this.dateRange = range;
  }

  getDateRangeStart(): Date {
    const now = new Date();
    switch (this.dateRange) {
      case '7days':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30days':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case 'quarter':
        const quarter = Math.floor(now.getMonth() / 3);
        return new Date(now.getFullYear(), quarter * 3, 1);
      case 'year':
        return new Date(now.getFullYear(), 0, 1);
      default:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }

  get filteredSales(): Sale[] {
    const start = this.getDateRangeStart();
    return this.sales.filter(
      (s) => new Date(s.timestamp) >= start && !s.pending
    );
  }

  get filteredExpenses(): Expense[] {
    const start = this.getDateRangeStart();
    return this.expenses.filter((e) => new Date(e.timestamp) >= start);
  }

  get totalIncome(): number {
    return this.filteredSales.reduce((sum, s) => sum + s.total, 0);
  }

  get totalExpenses(): number {
    return this.filteredExpenses.reduce((sum, e) => sum + e.price, 0);
  }

  get netProfit(): number {
    return this.totalIncome - this.totalExpenses;
  }

  get profitMargin(): number {
    return this.totalIncome > 0 ? (this.netProfit / this.totalIncome) * 100 : 0;
  }

  // Get monthly data for chart
  get monthlyData(): MonthlyData[] {
    const months: MonthlyData[] = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = date.toLocaleDateString('en-US', { month: 'short' });
      const nextMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const monthIncome = this.sales
        .filter((s) => {
          const saleDate = new Date(s.timestamp);
          return saleDate >= date && saleDate < nextMonth && !s.pending;
        })
        .reduce((sum, s) => sum + s.total, 0);

      const monthExpense = this.expenses
        .filter((e) => {
          const expDate = new Date(e.timestamp);
          return expDate >= date && expDate < nextMonth;
        })
        .reduce((sum, e) => sum + e.price, 0);

      months.push({
        month: monthName,
        income: monthIncome,
        expense: monthExpense,
      });
    }

    return months;
  }

  getBarHeight(value: number): number {
    const maxIncome = Math.max(...this.monthlyData.map((m) => m.income), 1);
    return Math.max((value / maxIncome) * 100, 5);
  }

  getExpenseBarHeight(value: number): number {
    const maxIncome = Math.max(...this.monthlyData.map((m) => m.income), 1);
    return Math.max((value / maxIncome) * 100, 5);
  }

  // Expense breakdown for donut chart
  get expenseBreakdown(): {
    name: string;
    value: number;
    percentage: number;
  }[] {
    const categories: { [key: string]: number } = {};

    this.filteredExpenses.forEach((e) => {
      const cat = 'General'; // Since we don't have categories in expense model
      categories[cat] = (categories[cat] || 0) + e.price;
    });

    const total = this.totalExpenses || 1;
    return Object.entries(categories).map(([name, value]) => ({
      name,
      value,
      percentage: Math.round((value / total) * 100),
    }));
  }

  // Recent transactions
  get recentTransactions(): Transaction[] {
    const transactions: Transaction[] = [];

    // Add sales as income
    this.sales
      .filter((s) => !s.pending)
      .slice(0, 10)
      .forEach((s) => {
        transactions.push({
          date: new Date(s.timestamp),
          description: s.productName,
          category: 'Sales',
          type: 'income',
          amount: s.total,
          status: 'completed',
        });
      });

    // Add pending sales
    this.sales
      .filter((s) => s.pending)
      .slice(0, 5)
      .forEach((s) => {
        transactions.push({
          date: new Date(s.timestamp),
          description: s.productName,
          category: 'Pending Sale',
          type: 'income',
          amount: s.total,
          status: 'pending',
        });
      });

    // Add expenses
    this.expenses.slice(0, 10).forEach((e) => {
      transactions.push({
        date: new Date(e.timestamp),
        description: e.productName,
        category: 'Expense',
        type: 'expense',
        amount: e.price,
        status: 'completed',
      });
    });

    // Sort by date descending and take top 10
    return transactions
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 10);
  }

  // Helpers
  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}
