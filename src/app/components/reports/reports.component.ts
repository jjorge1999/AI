import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { InventoryService } from '../../services/inventory.service';
import { PrintService } from '../../services/print.service';
import { StoreService } from '../../services/store.service';
import { DialogService } from '../../services/dialog.service';
import { CustomerService } from '../../services/customer.service';
import { Product, Sale, Expense } from '../../models/inventory.models';

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
  originalSale?: Sale;
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
  products: Product[] = [];
  private subscriptions: Subscription[] = [];

  // Receipt Preview State
  isReceiptPreviewOpen = false;
  lastReceiptData: any = null;
  isPrinting = false;

  // Date range filter
  dateRange = '30days';
  dateRanges = [
    { value: '7days', label: 'Last 7 Days' },
    { value: '30days', label: 'Last 30 Days' },
    { value: 'quarter', label: 'This Quarter' },
    { value: 'year', label: 'This Year' },
  ];

  searchQuery = '';

  constructor(
    private inventoryService: InventoryService,
    private printService: PrintService,
    private storeService: StoreService,
    private dialogService: DialogService,
    private customerService: CustomerService
  ) {}

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

    this.subscriptions.push(
      this.inventoryService.getProducts().subscribe((products) => {
        this.products = products;
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
      (s) => this.parseTimestamp(s.timestamp) >= start && !s.pending
    );
  }

  get filteredExpenses(): Expense[] {
    const start = this.getDateRangeStart();
    const result = this.expenses.filter(
      (e) => this.parseTimestamp(e.timestamp) >= start
    );
    console.log('Filtered expenses:', {
      total: this.expenses.length,
      filtered: result.length,
      dateRange: this.dateRange,
    });
    return result;
  }

  get grossRevenue(): number {
    return this.filteredSales.reduce((sum, s) => sum + s.total, 0);
  }

  get totalIncome(): number {
    // Redefined as "Actual Income" (Net Income) per user request
    // This is Revenue - Cost of Goods
    return this.filteredSales.reduce((sum, s) => {
      const costPerUnit =
        s.costPrice !== undefined
          ? s.costPrice
          : this.products.find((p) => p.id === s.productId)?.cost || 0;
      return sum + (s.total - costPerUnit * s.quantitySold);
    }, 0);
  }

  get totalExpenses(): number {
    return this.filteredExpenses.reduce((sum, e) => sum + (e.price || 0), 0);
  }

  get totalCOGS(): number {
    return this.filteredSales.reduce((sum, s) => {
      // Use recorded cost at time of sale, or current product cost as fallback, or 0
      const costPerUnit =
        s.costPrice !== undefined
          ? s.costPrice
          : this.products.find((p) => p.id === s.productId)?.cost || 0;
      return sum + costPerUnit * s.quantitySold;
    }, 0);
  }

  get netProfit(): number {
    // Net Profit = (Revenue - COGS) - Operational Expenses
    // Since totalIncome is now Net (Revenue - COGS), we just minus operational expenses
    return this.totalIncome - this.totalExpenses;
  }

  get profitMargin(): number {
    // Margin is traditionally (Net Profit / Gross Revenue)
    return this.grossRevenue > 0
      ? (this.netProfit / this.grossRevenue) * 100
      : 0;
  }

  // Get data for chart based on selected date range
  get monthlyData(): MonthlyData[] {
    const months: MonthlyData[] = [];
    const now = new Date();
    const rangeStart = this.getDateRangeStart();

    // Determine how many periods to show based on selected range
    let periods: { start: Date; end: Date; label: string }[] = [];

    switch (this.dateRange) {
      case '7days':
        // Show daily data for last 7 days
        for (let i = 6; i >= 0; i--) {
          const dayStart = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - i
          );
          const dayEnd = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - i + 1
          );
          periods.push({
            start: dayStart,
            end: dayEnd,
            label: dayStart.toLocaleDateString('en-US', { weekday: 'short' }),
          });
        }
        break;
      case '30days':
        // Show weekly data for last 30 days (4-5 weeks)
        for (let i = 4; i >= 0; i--) {
          const weekStart = new Date(
            now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000
          );
          const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
          periods.push({
            start: weekStart,
            end: weekEnd,
            label: `Week ${5 - i}`,
          });
        }
        break;
      case 'quarter':
        // Show monthly data for current quarter (3 months)
        const quarterStart = Math.floor(now.getMonth() / 3) * 3;
        for (let i = 0; i < 3; i++) {
          const monthStart = new Date(now.getFullYear(), quarterStart + i, 1);
          const monthEnd = new Date(now.getFullYear(), quarterStart + i + 1, 1);
          periods.push({
            start: monthStart,
            end: monthEnd,
            label: monthStart.toLocaleDateString('en-US', { month: 'short' }),
          });
        }
        break;
      case 'year':
      default:
        // Show monthly data for 6 months
        for (let i = 5; i >= 0; i--) {
          const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const monthEnd = new Date(
            now.getFullYear(),
            now.getMonth() - i + 1,
            1
          );
          periods.push({
            start: monthStart,
            end: monthEnd,
            label: monthStart.toLocaleDateString('en-US', { month: 'short' }),
          });
        }
        break;
    }

    for (const period of periods) {
      const periodIncome = this.sales
        .filter((s) => {
          const saleDate = this.parseTimestamp(s.timestamp);
          return (
            saleDate >= period.start && saleDate < period.end && !s.pending
          );
        })
        .reduce((sum, s) => {
          const costPerUnit =
            s.costPrice !== undefined
              ? s.costPrice
              : this.products.find((p) => p.id === s.productId)?.cost || 0;
          return sum + (s.total - costPerUnit * s.quantitySold);
        }, 0);

      const periodExpense = this.expenses
        .filter((e) => {
          const expDate = this.parseTimestamp(e.timestamp);
          return expDate >= period.start && expDate < period.end;
        })
        .reduce((sum, e) => sum + e.price, 0);

      months.push({
        month: period.label,
        income: periodIncome,
        expense: periodExpense,
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

  // Recent transactions - respects date filter
  get recentTransactions(): Transaction[] {
    const transactions: Transaction[] = [];
    const start = this.getDateRangeStart();

    // Add completed sales as income (filtered by date range)
    this.filteredSales.slice(0, 15).forEach((s) => {
      transactions.push({
        date: this.parseTimestamp(s.timestamp),
        description: s.productName,
        category: 'Sales',
        type: 'income',
        amount: s.total,
        status: 'completed',
        originalSale: s,
      });
    });

    // Add pending sales (always show these regardless of filter)
    this.sales
      .filter((s) => s.pending)
      .slice(0, 5)
      .forEach((s) => {
        transactions.push({
          date: this.parseTimestamp(s.timestamp),
          description: s.productName,
          category: 'Pending Sale',
          type: 'income',
          amount: s.total,
          status: 'pending',
          originalSale: s,
        });
      });

    // Add expenses (filtered by date range)
    this.filteredExpenses.slice(0, 15).forEach((e) => {
      transactions.push({
        date: this.parseTimestamp(e.timestamp),
        description: e.productName,
        category: 'Expense',
        type: 'expense',
        amount: e.price,
        status: 'completed',
      });
    });

    // Sort by date descending
    let sorted = transactions.sort(
      (a, b) => b.date.getTime() - a.date.getTime()
    );

    // Apply search filter
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      sorted = sorted.filter(
        (t) =>
          t.description.toLowerCase().includes(query) ||
          t.category.toLowerCase().includes(query) ||
          t.originalSale?.orderId?.toLowerCase().includes(query) ||
          t.originalSale?.customerName?.toLowerCase().includes(query)
      );
    }

    // Return top 10
    return sorted.slice(0, 10);
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

  /**
   * Safely parse a timestamp from various formats (Firestore Timestamp, Date, string, etc.)
   */
  private parseTimestamp(timestamp: any): Date {
    if (!timestamp) return new Date(0);
    if (timestamp instanceof Date) return timestamp;

    // Handle Firestore Timestamp object (with toDate method)
    if (
      typeof timestamp === 'object' &&
      typeof timestamp.toDate === 'function'
    ) {
      return timestamp.toDate();
    }

    // Handle serialized Timestamp (JSON) or internal representation
    if (
      typeof timestamp === 'object' &&
      (timestamp.seconds !== undefined || timestamp._seconds !== undefined)
    ) {
      const seconds = timestamp.seconds ?? timestamp._seconds;
      return new Date(seconds * 1000);
    }

    // String or number
    const parsed = new Date(timestamp);
    if (isNaN(parsed.getTime())) {
      return new Date(0); // Return epoch if invalid (won't match date range)
    }
    return parsed;
  }

  // Printing & Preview
  get printerStatus$() {
    return this.printService.connectionStatus$;
  }

  closeReceiptPreview(): void {
    this.isReceiptPreviewOpen = false;
  }

  async viewReceipt(tx: Transaction): Promise<void> {
    const sale = tx.originalSale;
    if (!sale) return;

    // Find all items in the same order if orderId exists
    let orderItems: Sale[] = [sale];
    if (sale.orderId) {
      orderItems = this.sales.filter((s) => s.orderId === sale.orderId);
    }

    const store = this.storeService
      .stores()
      .find((s: any) => s.id === sale.storeId);

    // Build receipt data
    this.lastReceiptData = {
      storeName: store?.name || 'JJM Store',
      storeAddress: store?.address,
      storePhone: store?.phoneNumber,
      orderId: sale.orderId || sale.id?.slice(-8) || 'N/A',
      date: this.parseTimestamp(sale.timestamp),
      items: orderItems.map((s) => ({
        name: s.productName,
        quantity: s.quantitySold,
        price: s.price || s.total / s.quantitySold,
        discount: s.discount,
        discountType: s.discountType,
        total: s.total,
      })),
      totalDiscount: orderItems.reduce((sum, s) => sum + (s.discount || 0), 0),
      total: orderItems.reduce((sum, s) => sum + (s.total || 0), 0),
      cashReceived: sale.cashReceived || 0,
      change: sale.change || 0,
      customerName: this.getCustomerName(sale) || undefined,
      deliveryDate: sale.deliveryDate ? new Date(sale.deliveryDate) : undefined,
      notes: sale.deliveryNotes,
    };

    this.isReceiptPreviewOpen = true;
  }

  private getCustomerName(sale: Sale): string {
    if (sale.customerName) return sale.customerName;
    if (sale.customerId) {
      const customer = this.customerService
        .customers()
        .find((c: any) => c.id === sale.customerId);
      if (customer) return customer.name;
    }
    return '';
  }

  async printFromPreview(): Promise<void> {
    if (!this.printService.isConnected()) {
      try {
        const connected = await this.printService.connectPrinter();
        if (!connected) return;
      } catch (error) {
        // User probably cancelled or bluetooth failed
        return;
      }
    }

    this.isPrinting = true;
    try {
      await this.printService.printReceipt(this.lastReceiptData);
      this.isReceiptPreviewOpen = false;
      this.dialogService.success(
        'Receipt printed successfully!',
        'Print Complete'
      );
    } catch (error: any) {
      this.dialogService.error(
        error.message || 'Failed to print receipt',
        'Print Error'
      );
    } finally {
      this.isPrinting = false;
    }
  }
}
