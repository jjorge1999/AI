import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { InventoryService } from '../../services/inventory.service';
import { CustomerService } from '../../services/customer.service';
import { Product, Sale, Customer } from '../../models/inventory.models';

interface KpiCard {
  title: string;
  value: string;
  icon: string;
  iconColor: string;
  trend: 'up' | 'down' | 'neutral';
  trendValue: string;
  trendLabel: string;
}

interface CategoryData {
  name: string;
  percentage: number;
  color: string;
}

interface RecentOrder {
  id: string;
  customer: string;
  avatar?: string;
  status: 'completed' | 'processing' | 'shipped' | 'pending';
  amount: number;
}

interface LowStockItem {
  name: string;
  sku: string;
  icon: string;
  stockLeft: number;
  reorderPoint: number;
  critical: boolean;
}

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css',
})
export class LandingComponent implements OnInit, OnDestroy {
  kpiCards: KpiCard[] = [];
  categories: CategoryData[] = [];
  recentOrders: RecentOrder[] = [];
  lowStockItems: LowStockItem[] = [];

  // Chart data points (for SVG path)
  salesChartPath = '';
  costsChartPath = '';

  private subscriptions: Subscription[] = [];
  private products: Product[] = [];
  private sales: Sale[] = [];
  private customers: Customer[] = [];

  // User info
  userName = 'User';
  userRole = 'Staff';

  constructor(
    private inventoryService: InventoryService,
    private customerService: CustomerService
  ) {
    this.userName =
      localStorage.getItem('jjm_fullname') ||
      localStorage.getItem('jjm_username') ||
      'User';
    this.userRole =
      localStorage.getItem('jjm_role') === 'admin'
        ? 'Administrator'
        : 'Staff Member';
  }

  ngOnInit(): void {
    // Load customers for name lookup
    this.customerService.loadCustomers();

    // Subscribe to customers
    this.subscriptions.push(
      this.customerService.getCustomers().subscribe((customers) => {
        this.customers = customers;
        this.updateDashboardData();
      })
    );

    // Subscribe to products and sales
    this.subscriptions.push(
      this.inventoryService.getProducts().subscribe((products) => {
        this.products = products;
        this.updateDashboardData();
      })
    );

    this.subscriptions.push(
      this.inventoryService.getSales().subscribe((sales) => {
        this.sales = sales;
        this.updateDashboardData();
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  private updateDashboardData(): void {
    this.calculateKpis();
    this.calculateCategories();
    this.loadRecentOrders();
    this.loadLowStockItems();
    this.generateChartPaths();
  }

  private calculateKpis(): void {
    // Total Stock Value
    const totalStockValue = this.products.reduce(
      (sum, p) => sum + p.price * (p.quantity || 0),
      0
    );

    // Low Stock Items count (using default threshold of 5)
    const LOW_STOCK_THRESHOLD = 5;
    const lowStockCount = this.products.filter(
      (p) => (p.quantity || 0) <= LOW_STOCK_THRESHOLD
    ).length;

    // Today's orders
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = this.sales.filter((s) => {
      const saleDate = new Date(s.timestamp).toISOString().split('T')[0];
      return saleDate === today;
    });

    // Month-to-date revenue
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const mtdSales = this.sales.filter((s) => {
      const saleDate = new Date(s.timestamp);
      return saleDate >= startOfMonth;
    });
    const mtdRevenue = mtdSales.reduce((sum, s) => sum + (s.total || 0), 0);

    this.kpiCards = [
      {
        title: 'Total Stock Value',
        value: this.formatCurrency(totalStockValue),
        icon: 'inventory',
        iconColor: '#137fec',
        trend: 'up',
        trendValue: '+2.5%',
        trendLabel: 'vs last month',
      },
      {
        title: 'Low Stock Items',
        value: lowStockCount.toString(),
        icon: 'warning',
        iconColor: '#f97316',
        trend: lowStockCount > 0 ? 'neutral' : 'up',
        trendValue: lowStockCount > 0 ? 'Action Needed' : 'All Good',
        trendLabel: '',
      },
      {
        title: 'Total Orders (Today)',
        value: todayOrders.length.toString(),
        icon: 'shopping_bag',
        iconColor: '#3b82f6',
        trend: 'up',
        trendValue: '+10%',
        trendLabel: 'vs yesterday',
      },
      {
        title: 'Revenue (MTD)',
        value: this.formatCurrency(mtdRevenue),
        icon: 'payments',
        iconColor: '#a855f7',
        trend: mtdRevenue > 0 ? 'up' : 'down',
        trendValue: mtdRevenue > 0 ? '+5.2%' : '0%',
        trendLabel: 'vs last month',
      },
    ];
  }

  private calculateCategories(): void {
    // Group products by category and calculate percentages
    const categoryMap: { [key: string]: number } = {};
    this.products.forEach((p) => {
      const category = p.category || 'Others';
      categoryMap[category] = (categoryMap[category] || 0) + 1;
    });

    const total = this.products.length || 1;
    const colors = ['#137fec', '#a855f7', '#f97316', '#94a3b8'];

    const sortedCategories = Object.entries(categoryMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);

    this.categories = sortedCategories.map(([name, count], index) => ({
      name,
      percentage: Math.round((count / total) * 100),
      color: colors[index] || '#94a3b8',
    }));

    // Fill remaining categories if less than 4
    if (this.categories.length === 0) {
      this.categories = [
        { name: 'Electronics', percentage: 45, color: colors[0] },
        { name: 'Home & Garden', percentage: 30, color: colors[1] },
        { name: 'Apparel', percentage: 15, color: colors[2] },
        { name: 'Others', percentage: 10, color: colors[3] },
      ];
    }
  }

  private loadRecentOrders(): void {
    // Get last 3 sales
    const recentSales = [...this.sales]
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, 3);

    this.recentOrders = recentSales.map((sale) => ({
      id: `#ORD-${sale.id?.slice(-4) || '0000'}`,
      customer: this.getCustomerDisplayName(sale),
      status: this.getSaleStatus(sale),
      amount: sale.total || 0,
    }));

    // If no sales, show sample data
    if (this.recentOrders.length === 0) {
      this.recentOrders = [
        {
          id: '#ORD-0001',
          customer: 'No recent orders',
          status: 'pending',
          amount: 0,
        },
      ];
    }
  }

  private getCustomerDisplayName(sale: Sale): string {
    // 1. First check if customerName is directly on the sale
    if (sale.customerName && sale.customerName.trim()) {
      return sale.customerName;
    }

    // 2. Try to look up by customerId
    if (sale.customerId) {
      const customer = this.customers.find((c) => c.id === sale.customerId);
      if (customer) {
        return customer.name;
      }
    }

    // 3. Fallback to Walk-in Customer
    return 'Walk-in Customer';
  }

  private getSaleStatus(
    sale: Sale
  ): 'completed' | 'processing' | 'shipped' | 'pending' {
    // Use pending and reservationStatus properties from Sale type
    if (!sale.pending) return 'completed';
    if (sale.reservationStatus === 'confirmed') return 'shipped';
    if (sale.reservationStatus === 'pending_confirmation') return 'processing';
    return 'pending';
  }

  private loadLowStockItems(): void {
    const LOW_STOCK_THRESHOLD = 5;
    const REORDER_POINT = 10;

    const lowStock = this.products
      .filter((p) => (p.quantity || 0) <= LOW_STOCK_THRESHOLD)
      .sort((a, b) => (a.quantity || 0) - (b.quantity || 0))
      .slice(0, 3);

    this.lowStockItems = lowStock.map((p) => ({
      name: p.name,
      sku: p.id?.slice(0, 12) || 'N/A',
      icon: this.getProductIcon(p.category),
      stockLeft: p.quantity || 0,
      reorderPoint: REORDER_POINT,
      critical: (p.quantity || 0) <= 2,
    }));

    // If no low stock, show placeholder
    if (this.lowStockItems.length === 0) {
      this.lowStockItems = [
        {
          name: 'All items in stock',
          sku: 'N/A',
          icon: 'check_circle',
          stockLeft: 100,
          reorderPoint: 10,
          critical: false,
        },
      ];
    }
  }

  private getProductIcon(category?: string): string {
    const iconMap: { [key: string]: string } = {
      electronics: 'smartphone',
      clothing: 'checkroom',
      food: 'restaurant',
      home: 'home',
      default: 'inventory_2',
    };
    return iconMap[(category || '').toLowerCase()] || iconMap['default'];
  }

  private generateChartPaths(): void {
    // Generate sample chart paths based on recent sales data
    // This creates smooth curves for the SVG chart
    this.salesChartPath = 'M0,40 Q10,35 20,25 T40,20 T60,15 T80,25 T100,10';
    this.costsChartPath = 'M0,45 Q15,42 30,35 T50,38 T70,30 T100,35';
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  getStatusClass(status: string): string {
    const classes: { [key: string]: string } = {
      completed: 'status-completed',
      processing: 'status-processing',
      shipped: 'status-shipped',
      pending: 'status-pending',
    };
    return classes[status] || 'status-pending';
  }

  getStatusLabel(status: string): string {
    const labels: { [key: string]: string } = {
      completed: 'Completed',
      processing: 'Processing',
      shipped: 'Shipped',
      pending: 'Pending',
    };
    return labels[status] || 'Pending';
  }
}
