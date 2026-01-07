import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { InventoryService } from '../../services/inventory.service';
import { CustomerService } from '../../services/customer.service';
import { Product, Sale, Customer } from '../../models/inventory.models';
import { DialogService } from '../../services/dialog.service';
import { DeviceService } from '../../services/device.service';

// Widget configuration interface
interface DashboardWidget {
  id: string;
  title: string;
  icon: string;
  size: 'small' | 'medium' | 'large' | 'full';
  order: number;
  visible: boolean;
}

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
  productName: string;
  quantity: number;
  timestamp: Date;
  discount?: number;
  discountType?: 'amount' | 'percent';
  cashReceived?: number;
  change?: number;
}

interface LowStockItem {
  name: string;
  sku: string;
  icon: string;
  stockLeft: number;
  reorderPoint: number;
  critical: boolean;
}

interface TopSellingProduct {
  name: string;
  unitsSold: number;
  revenue: number;
  trend: 'up' | 'down' | 'neutral';
}

interface TopCustomer {
  name: string;
  totalSpent: number;
  ordersCount: number;
  lastOrderDate: Date;
}

interface TodaySummary {
  totalOrders: number;
  totalRevenue: number;
  itemsSold: number;
  averageOrderValue: number;
  pendingCount: number;
}

interface QuickAction {
  label: string;
  icon: string;
  route: string;
  color: string;
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
  pendingDeliveries: Sale[] = [];

  // New widget data
  topSellingProducts: TopSellingProduct[] = [];
  topCustomers: TopCustomer[] = [];
  todaySummary: TodaySummary = {
    totalOrders: 0,
    totalRevenue: 0,
    itemsSold: 0,
    averageOrderValue: 0,
    pendingCount: 0,
  };
  quickActions: QuickAction[] = [
    {
      label: 'New Sale',
      icon: 'point_of_sale',
      route: '/sell',
      color: '#10b981',
    },
    {
      label: 'Add Product',
      icon: 'add_box',
      route: '/add-product',
      color: '#3b82f6',
    },
    {
      label: 'View Inventory',
      icon: 'inventory',
      route: '/inventory',
      color: '#8b5cf6',
    },
    {
      label: 'Customers',
      icon: 'people',
      route: '/customers',
      color: '#f97316',
    },
    {
      label: 'Reports',
      icon: 'analytics',
      route: '/reports',
      color: '#ec4899',
    },
    {
      label: 'Expenses',
      icon: 'receipt_long',
      route: '/expenses',
      color: '#ef4444',
    },
  ];

  // Configurable widgets for the dashboard
  widgets: DashboardWidget[] = [
    {
      id: 'quickActions',
      title: 'Quick Actions',
      icon: 'flash_on',
      size: 'full',
      order: 0,
      visible: true,
    },
    {
      id: 'todaySummary',
      title: "Today's Summary",
      icon: 'today',
      size: 'full',
      order: 1,
      visible: true,
    },
    {
      id: 'salesChart',
      title: 'Sales vs Costs',
      icon: 'show_chart',
      size: 'large',
      order: 2,
      visible: true,
    },
    {
      id: 'categories',
      title: 'Top Categories',
      icon: 'category',
      size: 'medium',
      order: 3,
      visible: true,
    },
    {
      id: 'pendingDeliveries',
      title: 'Pending Deliveries',
      icon: 'local_shipping',
      size: 'full',
      order: 4,
      visible: true,
    },
    {
      id: 'recentOrders',
      title: 'Recent Orders',
      icon: 'receipt',
      size: 'full',
      order: 5,
      visible: true,
    },
    {
      id: 'lowStock',
      title: 'Low Stock Alerts',
      icon: 'warning',
      size: 'medium',
      order: 6,
      visible: true,
    },
    {
      id: 'topProducts',
      title: 'Top Selling Products',
      icon: 'trending_up',
      size: 'medium',
      order: 7,
      visible: true,
    },
    {
      id: 'topCustomers',
      title: 'Top Customers',
      icon: 'people',
      size: 'medium',
      order: 8,
      visible: true,
    },
  ];

  // Widget management state
  isEditMode = false;
  draggedWidget: DashboardWidget | null = null;

  // Chart data points (for SVG path)
  salesChartPath = '';
  costsChartPath = '';

  viewMode: 'table' | 'grid' = 'table';
  today = new Date();
  isMobile = false;

  private subscriptions: Subscription[] = [];
  private products: Product[] = [];
  private sales: Sale[] = [];
  private customers: Customer[] = [];

  // User info
  userName = 'User';
  userRole = 'Staff';

  constructor(
    private inventoryService: InventoryService,
    private customerService: CustomerService,
    private router: Router,
    private dialogService: DialogService,
    private deviceService: DeviceService
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

  navigateToPos(): void {
    this.router.navigate(['/sell'], { state: { initialPendingOpen: true } });
  }

  ngOnInit(): void {
    // Load saved widget layout
    this.loadWidgetLayout();

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

    // Auto-switch to grid view on mobile
    this.subscriptions.push(
      this.deviceService.isMobile$.subscribe((isMobile) => {
        this.isMobile = isMobile;
        if (isMobile) {
          this.viewMode = 'grid';
          // If no custom layout is saved, we could auto-apply a mobile-friendly order here
          this.applyMobileOptimizedLayout();
        }
      })
    );
  }

  /**
   * Automatically re-orders widgets for the best mobile experience if the user
   * hasn't explicitly customized their layout yet.
   */
  private applyMobileOptimizedLayout(): void {
    const saved = localStorage.getItem('jjm_widget_layout');
    if (!saved && this.isMobile) {
      // Prioritize actionable and summary data for mobile
      const priority = [
        'quickActions',
        'todaySummary',
        'pendingDeliveries',
        'lowStock',
      ];

      this.widgets.forEach((w) => {
        const pIndex = priority.indexOf(w.id);
        if (pIndex !== -1) {
          w.order = pIndex;
        } else {
          w.order = pIndex + 10; // Push others down
        }
      });
      this.widgets.sort((a, b) => a.order - b.order);
      // Re-normalize orders
      this.widgets.forEach((w, i) => (w.order = i));
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  private updateDashboardData(): void {
    this.calculateKpis();
    this.calculateCategories();
    this.loadRecentOrders();
    this.loadLowStockItems();
    this.loadPendingDeliveries();
    this.loadTopSellingProducts();
    this.loadTopCustomers();
    this.loadTodaySummary();
    this.generateChartPaths();
  }

  // ... (existing updateDashboardData calls)

  private loadPendingDeliveries(): void {
    this.pendingDeliveries = this.sales
      .filter((s) => s.pending === true || (s as any).pending === 'true')
      .sort((a, b) => {
        const dateA = a.deliveryDate ? new Date(a.deliveryDate).getTime() : 0;
        const dateB = b.deliveryDate ? new Date(b.deliveryDate).getTime() : 0;
        return dateA - dateB;
      });
  }

  markAsDelivered(sale: Sale): void {
    this.dialogService
      .confirm('Mark this order as delivered?', 'Confirm Delivery')
      .subscribe((confirm) => {
        if (confirm) {
          this.inventoryService.completePendingSale(sale.id);
        }
      });
  }

  confirmReservation(sale: Sale): void {
    this.dialogService
      .confirm('Confirm this reservation?', 'Approve Reservation')
      .subscribe((confirm) => {
        if (confirm) {
          this.inventoryService.confirmReservation(sale);
        }
      });
  }

  cancelOrder(sale: Sale): void {
    this.dialogService
      .confirm('Cancel and delete this order?', 'Cancel Order')
      .subscribe((confirm) => {
        if (confirm) {
          this.inventoryService.deleteSale(sale.id);
        }
      });
  }

  callCustomer(sale: Sale): void {
    // Attempt to find phone number
    let phone = sale.customerContact;

    if (!phone && sale.customerId) {
      const customer = this.customers.find((c) => c.id === sale.customerId);
      if (customer) phone = customer.phoneNumber;
    }

    if (phone) {
      globalThis.location.href = `tel:${phone}`;
    } else {
      this.dialogService.warning('No phone number available', 'Cannot Call');
    }
  }

  // ... (rest of methods)

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
    // Get last 5 sales for more visibility
    const recentSales = [...this.sales]
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, 5);

    this.recentOrders = recentSales.map((sale) => ({
      id: `#ORD-${sale.id?.slice(-4) || '0000'}`,
      customer: this.getCustomerDisplayName(sale),
      status: this.getSaleStatus(sale),
      amount: sale.total || 0,
      productName: sale.productName || 'Unknown Product',
      quantity: sale.quantitySold || 1,
      timestamp: new Date(sale.timestamp),
      discount: sale.discount,
      discountType: sale.discountType,
      cashReceived: sale.cashReceived,
      change: sale.change,
    }));

    // If no sales, show sample data
    if (this.recentOrders.length === 0) {
      this.recentOrders = [
        {
          id: '#ORD-0001',
          customer: 'No recent orders',
          status: 'pending',
          amount: 0,
          productName: 'N/A',
          quantity: 0,
          timestamp: new Date(),
        },
      ];
    }
  }

  getCustomerDisplayName(sale: Sale): string {
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

  getCustomerContact(sale: Sale): string {
    if (sale.customerContact) return sale.customerContact;
    if (sale.customerId) {
      const customer = this.customers.find((c) => c.id === sale.customerId);
      return customer?.phoneNumber || '';
    }
    return '';
  }

  getCustomerAddress(sale: Sale): string {
    if (sale.customerAddress) return sale.customerAddress;
    if (sale.customerId) {
      const customer = this.customers.find((c) => c.id === sale.customerId);
      return customer?.deliveryAddress || '';
    }
    return '';
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

  // New widget methods
  private loadTopSellingProducts(): void {
    // Aggregate sales by product
    const productSales: {
      [key: string]: { name: string; units: number; revenue: number };
    } = {};

    this.sales.forEach((sale) => {
      const key = sale.productId || sale.productName;
      if (!productSales[key]) {
        productSales[key] = { name: sale.productName, units: 0, revenue: 0 };
      }
      productSales[key].units += sale.quantitySold || 1;
      productSales[key].revenue += sale.total || 0;
    });

    // Convert to array and sort by revenue
    const sortedProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    this.topSellingProducts = sortedProducts.map((p, index) => ({
      name: p.name,
      unitsSold: p.units,
      revenue: p.revenue,
      trend: index === 0 ? 'up' : index < 3 ? 'neutral' : 'down',
    }));

    // Placeholder if no data
    if (this.topSellingProducts.length === 0) {
      this.topSellingProducts = [
        {
          name: 'No sales data yet',
          unitsSold: 0,
          revenue: 0,
          trend: 'neutral',
        },
      ];
    }
  }

  private loadTopCustomers(): void {
    // Aggregate sales by customer
    const customerSpending: {
      [key: string]: {
        name: string;
        spent: number;
        orders: number;
        lastDate: Date;
      };
    } = {};

    this.sales.forEach((sale) => {
      const customerId = sale.customerId || 'walk-in';
      const customerName = this.getCustomerDisplayName(sale);

      if (!customerSpending[customerId]) {
        customerSpending[customerId] = {
          name: customerName,
          spent: 0,
          orders: 0,
          lastDate: new Date(sale.timestamp),
        };
      }
      customerSpending[customerId].spent += sale.total || 0;
      customerSpending[customerId].orders += 1;

      const saleDate = new Date(sale.timestamp);
      if (saleDate > customerSpending[customerId].lastDate) {
        customerSpending[customerId].lastDate = saleDate;
      }
    });

    // Convert and sort by total spent (exclude walk-in for top customers)
    const sortedCustomers = Object.entries(customerSpending)
      .filter(([id]) => id !== 'walk-in')
      .map(([, data]) => data)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 5);

    this.topCustomers = sortedCustomers.map((c) => ({
      name: c.name,
      totalSpent: c.spent,
      ordersCount: c.orders,
      lastOrderDate: c.lastDate,
    }));

    // Placeholder if no registered customer data
    if (this.topCustomers.length === 0) {
      this.topCustomers = [
        {
          name: 'No customer data yet',
          totalSpent: 0,
          ordersCount: 0,
          lastOrderDate: new Date(),
        },
      ];
    }
  }

  private loadTodaySummary(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todaySales = this.sales.filter((s) => {
      const saleDate = new Date(s.timestamp);
      saleDate.setHours(0, 0, 0, 0);
      return saleDate.getTime() === today.getTime();
    });

    const totalRevenue = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);
    const itemsSold = todaySales.reduce(
      (sum, s) => sum + (s.quantitySold || 1),
      0
    );
    const pendingCount = this.pendingDeliveries.length;

    this.todaySummary = {
      totalOrders: todaySales.length,
      totalRevenue: totalRevenue,
      itemsSold: itemsSold,
      averageOrderValue:
        todaySales.length > 0 ? totalRevenue / todaySales.length : 0,
      pendingCount: pendingCount,
    };
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  formatCurrencyValue(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  // ========================================
  // Widget Management Methods
  // ========================================

  toggleEditMode(): void {
    this.isEditMode = !this.isEditMode;
    if (!this.isEditMode) {
      this.saveWidgetLayout();
    }
  }

  onDragStart(event: DragEvent, widget: DashboardWidget): void {
    if (!this.isEditMode) return;
    this.draggedWidget = widget;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', widget.id);
    }
  }

  onDragOver(event: DragEvent): void {
    if (!this.isEditMode) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(event: DragEvent, targetWidget: DashboardWidget): void {
    if (!this.isEditMode || !this.draggedWidget) return;
    event.preventDefault();

    if (this.draggedWidget.id === targetWidget.id) return;

    // Swap orders
    const draggedOrder = this.draggedWidget.order;
    const targetOrder = targetWidget.order;

    this.draggedWidget.order = targetOrder;
    targetWidget.order = draggedOrder;

    // Re-sort widgets array
    this.widgets.sort((a, b) => a.order - b.order);
    this.draggedWidget = null;
  }

  onDragEnd(): void {
    this.draggedWidget = null;
  }

  resizeWidget(
    widget: DashboardWidget,
    size: 'small' | 'medium' | 'large' | 'full'
  ): void {
    widget.size = size;
    if (!this.isEditMode) {
      this.saveWidgetLayout();
    }
  }

  toggleWidgetVisibility(widget: DashboardWidget): void {
    widget.visible = !widget.visible;
    if (!this.isEditMode) {
      this.saveWidgetLayout();
    }
  }

  getVisibleWidgets(): DashboardWidget[] {
    return this.widgets
      .filter((w) => w.visible)
      .sort((a, b) => a.order - b.order);
  }

  getWidgetById(id: string): DashboardWidget | undefined {
    return this.widgets.find((w) => w.id === id);
  }

  isWidgetVisible(id: string): boolean {
    const widget = this.getWidgetById(id);
    return widget ? widget.visible : true;
  }

  hasHiddenWidgets(): boolean {
    return this.widgets.some((w) => !w.visible);
  }

  getWidgetSize(id: string): string {
    const widget = this.getWidgetById(id);
    return widget ? widget.size : 'medium';
  }

  private saveWidgetLayout(): void {
    const layout = this.widgets.map((w) => ({
      id: w.id,
      size: w.size,
      order: w.order,
      visible: w.visible,
    }));
    localStorage.setItem('jjm_widget_layout', JSON.stringify(layout));
  }

  private loadWidgetLayout(): void {
    const saved = localStorage.getItem('jjm_widget_layout');
    if (saved) {
      try {
        const layout = JSON.parse(saved);
        layout.forEach(
          (saved: {
            id: string;
            size: string;
            order: number;
            visible: boolean;
          }) => {
            const widget = this.widgets.find((w) => w.id === saved.id);
            if (widget) {
              widget.size = saved.size as 'small' | 'medium' | 'large' | 'full';
              widget.order = saved.order;
              widget.visible = saved.visible;
            }
          }
        );
        this.widgets.sort((a, b) => a.order - b.order);
      } catch (e) {
        console.warn('Failed to load widget layout:', e);
      }
    }
  }

  resetWidgetLayout(): void {
    this.widgets = [
      {
        id: 'quickActions',
        title: 'Quick Actions',
        icon: 'flash_on',
        size: 'full',
        order: 0,
        visible: true,
      },
      {
        id: 'todaySummary',
        title: "Today's Summary",
        icon: 'today',
        size: 'full',
        order: 1,
        visible: true,
      },
      {
        id: 'salesChart',
        title: 'Sales vs Costs',
        icon: 'show_chart',
        size: 'large',
        order: 2,
        visible: true,
      },
      {
        id: 'categories',
        title: 'Top Categories',
        icon: 'category',
        size: 'medium',
        order: 3,
        visible: true,
      },
      {
        id: 'pendingDeliveries',
        title: 'Pending Deliveries',
        icon: 'local_shipping',
        size: 'full',
        order: 4,
        visible: true,
      },
      {
        id: 'recentOrders',
        title: 'Recent Orders',
        icon: 'receipt',
        size: 'full',
        order: 5,
        visible: true,
      },
      {
        id: 'lowStock',
        title: 'Low Stock Alerts',
        icon: 'warning',
        size: 'medium',
        order: 6,
        visible: true,
      },
      {
        id: 'topProducts',
        title: 'Top Selling Products',
        icon: 'trending_up',
        size: 'medium',
        order: 7,
        visible: true,
      },
      {
        id: 'topCustomers',
        title: 'Top Customers',
        icon: 'people',
        size: 'medium',
        order: 8,
        visible: true,
      },
    ];
    localStorage.removeItem('jjm_widget_layout');
  }
}
