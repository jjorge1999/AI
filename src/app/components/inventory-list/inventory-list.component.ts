import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { CustomerService } from '../../services/customer.service';
import { DialogService } from '../../services/dialog.service';
import { PrintService, ReceiptData } from '../../services/print.service';
import { StoreService } from '../../services/store.service';
import { Product, Sale, Customer } from '../../models/inventory.models';
import { Subscription } from 'rxjs';
import { DeviceService } from '../../services/device.service';

@Component({
  selector: 'app-inventory-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventory-list.component.html',
  styleUrl: './inventory-list.component.css',
})
// Inventory List Component
export class InventoryListComponent implements OnInit, OnDestroy {
  // State using Signals
  productsSignal = this.inventoryService.products;
  salesSignal = this.inventoryService.sales;
  customersSignal = this.customerService.customers;
  isMobile = this.deviceService.isMobile;

  get products(): Product[] {
    return this.productsSignal();
  }
  get sales(): Sale[] {
    return this.salesSignal();
  }
  get customers(): Customer[] {
    return this.customersSignal();
  }

  inventoryViewMode: 'table' | 'grid' = 'table';
  private subscriptions: Subscription = new Subscription();

  // Category filter
  selectedCategory: string = 'All';
  categories: string[] = [
    'All',
    'Lechon',
    'Hollow blocks',
    'Sand and Gravel',
    'Copra',
    'Others',
  ];

  // Page size options
  pageSizeOptions: number[] = [10, 20, 50, 100];

  // Pagination for available products
  availableProductsPage = 1;
  availableProductsPageSize = 10;

  // Pagination for sales
  salesPage = 1;
  salesPageSize = 10;

  // Pagination for out of stock
  outOfStockPage = 1;
  outOfStockPageSize = 10;

  // Pagination for Pending Deliveries (New)
  pendingPage = 1;
  pendingPageSize = 10;

  // Search Queries for tables
  globalSearchQuery = '';
  stockSearchQuery = '';
  salesSearchQuery = '';
  pendingSearchQuery = '';

  // Edit Modal State
  isEditModalOpen = false;
  editingProduct: Product | null = null;
  editProductName: string = '';
  editProductQuantity: number = 0;
  editProductPrice: number = 0;
  editProductCost: number = 0;
  editProductImage: string = '';
  editImagePreview: string | null = null;

  // Restock Modal State
  isRestockModalOpen = false;
  restockingProduct: Product | null = null;
  restockQuantity: number = 0;

  // Breakdown Modal State
  isBreakdownModalOpen = false;
  breakdownProduct: Product | null = null;
  breakdownQuantity: number = 0;
  breakdownCostPerUnit: number = 0;
  breakdownNotes: string = '';

  // Receipt Preview State
  isReceiptPreviewOpen = false;
  lastReceiptData: any = null;
  isPrinting = false;
  printerStatus$ = this.printService.connectionStatus$;
  printerName$ = this.printService.deviceName$;

  constructor(
    private inventoryService: InventoryService,
    private customerService: CustomerService,
    private dialogService: DialogService,
    private deviceService: DeviceService,
    private printService: PrintService,
    private storeService: StoreService
  ) {}

  ngOnInit(): void {
    // Load data if not already present (SWR behavior)
    this.customerService.loadCustomers();

    // Auto-switch to grid view on mobile (Signal-based)
    if (this.isMobile()) {
      this.inventoryViewMode = 'grid';
    }
  }

  onHeaderSearchChange(query: string): void {
    this.globalSearchQuery = query;
    this.availableProductsPage = 1;
    this.salesPage = 1;
    this.pendingPage = 1;
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get pendingSales(): Sale[] {
    return this.salesSignal().filter((s: Sale) => s.pending === true);
  }

  get groupedPendingSales(): any[] {
    const groups = new Map<string, Sale[]>();
    const singles: Sale[] = [];

    this.pendingSales.forEach((sale) => {
      if (sale.orderId) {
        if (!groups.has(sale.orderId)) {
          groups.set(sale.orderId, []);
        }
        groups.get(sale.orderId)!.push(sale);
      } else {
        singles.push(sale);
      }
    });

    const result: any[] = [];

    // Process Groups
    groups.forEach((sales, orderId) => {
      const first = sales[0];
      const customerName = this.getCustomerName(first);
      result.push({
        isGroup: true,
        orderId: orderId,
        sales: sales,
        total: sales.reduce((sum, s) => sum + s.total, 0),
        productName: `Order #${orderId.substring(4, 10)}...`,
        quantityCount: sales.length,
        items: sales,
        timestamp: first.timestamp,
        deliveryDate: first.deliveryDate,
        deliveryNotes: first.deliveryNotes,
        pending: true,
        customerName: customerName,
        reservationStatus: first.reservationStatus,
      });
    });

    // Process Singles
    singles.forEach((sale) => {
      const customerName = this.getCustomerName(sale);
      result.push({
        isGroup: false,
        sales: [sale],
        total: sale.total,
        productName: sale.productName,
        quantityCount: 1,
        items: [sale],
        timestamp: sale.timestamp,
        deliveryDate: sale.deliveryDate,
        deliveryNotes: sale.deliveryNotes,
        pending: true,
        customerName: customerName,
        reservationStatus: sale.reservationStatus,
      });
    });

    let sorted = result.sort((a, b) => {
      const aTime = a.deliveryDate
        ? new Date(a.deliveryDate).getTime()
        : Infinity;
      const bTime = b.deliveryDate
        ? new Date(b.deliveryDate).getTime()
        : Infinity;
      return aTime - bTime;
    });

    // Apply search filter (Global and specific)
    if (this.globalSearchQuery) {
      const q = this.globalSearchQuery.toLowerCase().trim();
      sorted = sorted.filter(
        (s) =>
          s.productName?.toLowerCase().includes(q) ||
          s.customerName?.toLowerCase().includes(q) ||
          s.orderId?.toLowerCase().includes(q)
      );
    }
    if (this.pendingSearchQuery) {
      const q = this.pendingSearchQuery.toLowerCase().trim();
      sorted = sorted.filter(
        (s) =>
          s.productName?.toLowerCase().includes(q) ||
          s.customerName?.toLowerCase().includes(q) ||
          s.orderId?.toLowerCase().includes(q)
      );
    }

    return sorted;
  }

  get filteredSales(): Sale[] {
    // Exclude pending sales; only show completed ones
    const completed = this.salesSignal().filter(
      (s: Sale) => s.pending !== true
    );
    if (this.selectedCategory === 'All') {
      return completed;
    }
    return completed.filter((s: Sale) => s.category === this.selectedCategory);
  }

  /**
   * Groups completed sales by orderId to show unique orders.
   * Returns an array of grouped order objects.
   */
  get groupedCompletedSales(): any[] {
    const sales = this.filteredSales;
    const groups = new Map<string, Sale[]>();
    const singles: Sale[] = [];

    sales.forEach((sale) => {
      if (sale.orderId) {
        if (!groups.has(sale.orderId)) {
          groups.set(sale.orderId, []);
        }
        groups.get(sale.orderId)!.push(sale);
      } else {
        // Sales without orderId are treated as single-item orders
        singles.push(sale);
      }
    });

    const result: any[] = [];

    // Process grouped orders
    groups.forEach((groupSales, orderId) => {
      const first = groupSales[0];
      const totalAmount = groupSales.reduce((sum, s) => sum + s.total, 0);
      const totalQty = groupSales.reduce((sum, s) => sum + s.quantitySold, 0);
      const productNames = groupSales.map((s) => s.productName).join(', ');

      result.push({
        isGroup: true,
        orderId,
        sales: groupSales,
        productName:
          groupSales.length > 1
            ? `${groupSales.length} items`
            : first.productName,
        productNamesFull: productNames,
        customerName: this.getCustomerName(first),
        quantitySold: totalQty,
        total: totalAmount,
        timestamp: first.timestamp,
        category: first.category,
        id: first.id,
      });
    });

    // Process single sales
    singles.forEach((sale) => {
      result.push({
        isGroup: false,
        orderId: sale.id,
        sales: [sale],
        productName: sale.productName,
        productNamesFull: sale.productName,
        customerName: this.getCustomerName(sale),
        quantitySold: sale.quantitySold,
        total: sale.total,
        timestamp: sale.timestamp,
        category: sale.category,
        id: sale.id,
      });
    });

    // Sort by timestamp descending (newest first)
    let sorted = result.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Apply search filter (Global and specific)
    if (this.globalSearchQuery) {
      const q = this.globalSearchQuery.toLowerCase().trim();
      sorted = sorted.filter(
        (s) =>
          s.productName?.toLowerCase().includes(q) ||
          s.productNamesFull?.toLowerCase().includes(q) ||
          s.customerName?.toLowerCase().includes(q) ||
          s.orderId?.toLowerCase().includes(q)
      );
    }
    if (this.salesSearchQuery) {
      const q = this.salesSearchQuery.toLowerCase().trim();
      sorted = sorted.filter(
        (s) =>
          s.productName?.toLowerCase().includes(q) ||
          s.productNamesFull?.toLowerCase().includes(q) ||
          s.customerName?.toLowerCase().includes(q) ||
          s.orderId?.toLowerCase().includes(q)
      );
    }

    return sorted;
  }

  get paginatedSales(): any[] {
    const start = (this.salesPage - 1) * this.salesPageSize;
    const end = start + this.salesPageSize;
    return this.groupedCompletedSales.slice(start, end);
  }

  get salesTotalPages(): number {
    return Math.ceil(this.groupedCompletedSales.length / this.salesPageSize);
  }

  get availableProducts(): Product[] {
    let products = this.productsSignal();

    if (this.globalSearchQuery) {
      const q = this.globalSearchQuery.toLowerCase().trim();
      products = products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.category?.toLowerCase().includes(q)
      );
    }
    if (this.stockSearchQuery) {
      const q = this.stockSearchQuery.toLowerCase().trim();
      products = products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.category?.toLowerCase().includes(q)
      );
    }

    return products;
  }

  get paginatedAvailableProducts(): Product[] {
    const start =
      (this.availableProductsPage - 1) * this.availableProductsPageSize;
    const end = start + this.availableProductsPageSize;
    return this.availableProducts.slice(start, end);
  }

  get availableProductsTotalPages(): number {
    return Math.ceil(
      this.availableProducts.length / this.availableProductsPageSize
    );
  }

  get outOfStockProducts(): Product[] {
    let products = this.productsSignal().filter(
      (p: Product) => p.quantity === 0
    );

    if (this.globalSearchQuery) {
      const q = this.globalSearchQuery.toLowerCase().trim();
      products = products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.category?.toLowerCase().includes(q)
      );
    }
    if (this.stockSearchQuery) {
      const q = this.stockSearchQuery.toLowerCase().trim();
      products = products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.category?.toLowerCase().includes(q)
      );
    }

    return products;
  }

  get paginatedOutOfStockProducts(): Product[] {
    const start = (this.outOfStockPage - 1) * this.outOfStockPageSize;
    const end = start + this.outOfStockPageSize;
    return this.outOfStockProducts.slice(start, end);
  }

  get outOfStockTotalPages(): number {
    return Math.ceil(this.outOfStockProducts.length / this.outOfStockPageSize);
  }

  get salesByCategory(): { category: string; total: number; count: number }[] {
    const categoryMap = new Map<string, { total: number; count: number }>();

    // Only consider delivered (non-pending) sales for analytics
    this.salesSignal()
      .filter((s: Sale) => !s.pending)
      .forEach((sale: Sale) => {
        const existing = categoryMap.get(sale.category) || {
          total: 0,
          count: 0,
        };
        categoryMap.set(sale.category, {
          total: existing.total + sale.total,
          count: existing.count + 1,
        });
      });

    return Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      total: data.total,
      count: data.count,
    }));
  }

  get totalInventoryValue(): number {
    return this.productsSignal().reduce(
      (sum: number, p: Product) => sum + p.price * p.quantity,
      0
    );
  }

  get totalSalesValue(): number {
    // Only consider delivered (non-pending) sales
    return this.salesSignal()
      .filter((s: Sale) => !s.pending)
      .reduce((sum: number, s: Sale) => sum + s.total, 0);
  }

  // Pagination methods for available products
  nextAvailablePage(): void {
    if (this.availableProductsPage < this.availableProductsTotalPages) {
      this.availableProductsPage++;
    }
  }

  prevAvailablePage(): void {
    if (this.availableProductsPage > 1) {
      this.availableProductsPage--;
    }
  }

  goToAvailablePage(page: number): void {
    if (page >= 1 && page <= this.availableProductsTotalPages) {
      this.availableProductsPage = page;
    }
  }

  // Pagination methods for sales
  nextSalesPage(): void {
    if (this.salesPage < this.salesTotalPages) {
      this.salesPage++;
    }
  }

  prevSalesPage(): void {
    if (this.salesPage > 1) {
      this.salesPage--;
    }
  }

  goToSalesPage(page: number): void {
    if (page >= 1 && page <= this.salesTotalPages) {
      this.salesPage = page;
    }
  }

  // Pagination methods for out of stock
  nextOutOfStockPage(): void {
    if (this.outOfStockPage < this.outOfStockTotalPages) {
      this.outOfStockPage++;
    }
  }

  prevOutOfStockPage(): void {
    if (this.outOfStockPage > 1) {
      this.outOfStockPage--;
    }
  }

  goToOutOfStockPage(page: number): void {
    this.outOfStockPage = page;
  }

  // Pagination getters & methods for Pending Sales
  get paginatedPendingSales(): any[] {
    const start = (this.pendingPage - 1) * this.pendingPageSize;
    const end = start + this.pendingPageSize;
    return this.groupedPendingSales.slice(start, end);
  }

  get pendingTotalPages(): number {
    return Math.ceil(this.groupedPendingSales.length / this.pendingPageSize);
  }

  nextPendingPage(): void {
    if (this.pendingPage < this.pendingTotalPages) {
      this.pendingPage++;
    }
  }

  prevPendingPage(): void {
    if (this.pendingPage > 1) {
      this.pendingPage--;
    }
  }

  goToPendingPage(page: number): void {
    this.pendingPage = page;
  }

  onPendingPageSizeChange(): void {
    this.pendingPage = 1;
  }

  // Page size change handlers
  onAvailablePageSizeChange(): void {
    this.availableProductsPage = 1;
  }

  onSalesPageSizeChange(): void {
    this.salesPage = 1;
  }

  onOutOfStockPageSizeChange(): void {
    this.outOfStockPage = 1;
  }

  // Helper to get page numbers for pagination UI
  getPageNumbers(totalPages: number): number[] {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  onRestock(product: Product): void {
    this.restockingProduct = product;
    this.restockQuantity = 0;
    this.isRestockModalOpen = true;
  }

  closeRestockModal(): void {
    this.isRestockModalOpen = false;
    this.restockingProduct = null;
    this.restockQuantity = 0;
  }

  confirmRestock(): void {
    if (this.restockingProduct && this.restockQuantity > 0) {
      this.inventoryService.restockProduct(
        this.restockingProduct.id,
        this.restockQuantity
      );
      this.closeRestockModal();
    }
  }

  // Breakdown Methods
  onBreakdown(product: Product): void {
    this.breakdownProduct = product;
    this.breakdownQuantity = 1; // Default to 1
    this.breakdownCostPerUnit = product.cost || 0;
    this.breakdownNotes = `Breakdown of ${product.name}`;
    this.isBreakdownModalOpen = true;
  }

  closeBreakdownModal(): void {
    this.isBreakdownModalOpen = false;
    this.breakdownProduct = null;
    this.breakdownQuantity = 0;
    this.breakdownCostPerUnit = 0;
    this.breakdownNotes = '';
  }

  confirmBreakdown(): void {
    if (this.breakdownProduct && this.breakdownQuantity > 0) {
      if (this.breakdownQuantity > this.breakdownProduct.quantity) {
        this.dialogService.warning(
          `Only ${this.breakdownProduct.quantity} items available for breakdown.`,
          'Insufficient Quantity'
        );
        return;
      }

      const totalCost = this.breakdownQuantity * this.breakdownCostPerUnit;

      // 1. Deduct from inventory
      this.inventoryService
        .updateProduct({
          ...this.breakdownProduct,
          quantity: this.breakdownProduct.quantity - this.breakdownQuantity,
        })
        .subscribe();

      // 2. Record as expense
      this.inventoryService
        .addExpense({
          productName: `[Breakdown] ${this.breakdownProduct.name}`,
          price: totalCost,
          notes: this.breakdownNotes || `Used for production/breakdown`,
        })
        .subscribe();

      this.dialogService.success(
        `${this.breakdownQuantity} items of ${this.breakdownProduct.name} broken down and tracked as ₱${totalCost} expense.`,
        'Breakdown Successful'
      );

      this.closeBreakdownModal();
    }
  }

  openEditModal(product: Product): void {
    this.editingProduct = product;
    this.editProductName = product.name;
    this.editProductQuantity = product.quantity;
    this.editProductPrice = product.price;
    this.editProductCost = product.cost || 0;
    this.editProductImage = product.imageUrl || '';
    this.editImagePreview = product.imageUrl || null;
    this.isEditModalOpen = true;
  }

  closeEditModal(): void {
    this.isEditModalOpen = false;
    this.editingProduct = null;
    this.editProductName = '';
    this.editProductQuantity = 0;
    this.editProductPrice = 0;
    this.editProductCost = 0;
    this.editProductImage = '';
    this.editImagePreview = null;
  }

  onEditImageChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];

      // No size limit - images will be compressed automatically

      const reader = new FileReader();

      reader.onload = (e: ProgressEvent<FileReader>) => {
        const img = new Image();
        img.src = e.target?.result as string;

        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Resize logic: Max dimension 800px
          const maxDim = 800;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            // Compress to JPEG with 0.7 quality
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

            this.editImagePreview = dataUrl;
            this.editProductImage = dataUrl;
          }
        };
      };

      reader.readAsDataURL(file);
    }
  }

  removeEditImage(): void {
    this.editImagePreview = null;
    this.editProductImage = '';
  }

  saveProductEdit(): void {
    if (!this.editingProduct) return;

    if (!this.editProductName.trim()) {
      this.dialogService.warning(
        'Product name cannot be empty',
        'Validation Error'
      );
      return;
    }

    if (this.editProductQuantity < 0) {
      this.dialogService.warning(
        'Quantity cannot be negative',
        'Validation Error'
      );
      return;
    }

    if (this.editProductPrice < 0) {
      this.dialogService.warning(
        'Price cannot be negative',
        'Validation Error'
      );
      return;
    }

    const updatedProduct: Product = {
      ...this.editingProduct,
      name: this.editProductName,
      quantity: this.editProductQuantity,
      price: this.editProductPrice,
      cost: this.editProductCost,
      imageUrl: this.editProductImage,
    };

    this.inventoryService.updateProduct(updatedProduct).subscribe();
    this.closeEditModal();
  }

  // Get customer name by ID or from sale record
  getCustomerName(sale: Sale): string {
    // First check if customerName is already in the sale
    if (sale.customerName) {
      return sale.customerName;
    }

    // If not, try to look up by customerId
    if (sale.customerId) {
      const customer = this.customersSignal().find(
        (c: Customer) => c.id === sale.customerId
      );
      if (customer) {
        return customer.name;
      }
    }

    return '';
  }

  // Mark a pending delivery as delivered
  markAsDelivered(group: any): void {
    const message = group.isGroup
      ? `Mark all ${group.quantityCount} items in this order as delivered?`
      : `Mark "${group.productName}" as delivered?`;

    this.dialogService
      .confirm(message, 'Mark as Delivered')
      .subscribe((confirmed) => {
        if (confirmed) {
          group.sales.forEach((sale: Sale) => {
            this.inventoryService.completePendingSale(sale.id);
          });
        }
      });
  }

  // Cancel a pending delivery
  cancelDelivery(group: any): void {
    const message = group.isGroup
      ? `Cancel all ${group.quantityCount} items in this order? This action cannot be undone.`
      : `Cancel delivery for "${group.productName}"? This action cannot be undone.`;

    this.dialogService
      .confirm(message, 'Cancel Delivery')
      .subscribe((confirmed) => {
        if (confirmed) {
          group.sales.forEach((sale: Sale) => {
            this.inventoryService.deleteSale(sale.id);
          });
        }
      });
  }

  // Confirm a reservation (deducts from inventory)
  confirmReservation(group: any): void {
    const message = group.isGroup
      ? `Confirm all ${group.quantityCount} items in this order? This will deduct items from inventory.`
      : `Confirm reservation for "${group.productName}"? This will deduct items from inventory.`;

    this.dialogService
      .confirm(message, 'Confirm Reservation')
      .subscribe((confirmed) => {
        if (confirmed) {
          group.sales.forEach((sale: Sale) => {
            this.inventoryService.confirmReservation(sale);
          });
        }
      });
  }

  // Edit pending delivery modal state
  isEditDeliveryModalOpen = false;
  editingDeliveryGroup: any = null;
  editDeliveryDate: string = '';
  editDeliveryNotes: string = '';

  openEditDeliveryModal(group: any): void {
    this.editingDeliveryGroup = group;
    const firstSale = group.sales[0];
    this.editDeliveryDate = firstSale.deliveryDate
      ? new Date(firstSale.deliveryDate).toISOString().split('T')[0]
      : '';
    this.editDeliveryNotes = firstSale.deliveryNotes || '';
    this.isEditDeliveryModalOpen = true;
  }

  closeEditDeliveryModal(): void {
    this.isEditDeliveryModalOpen = false;
    this.editingDeliveryGroup = null;
    this.editDeliveryDate = '';
    this.editDeliveryNotes = '';
  }

  saveDeliveryEdit(): void {
    if (!this.editingDeliveryGroup) return;

    const newDate = this.editDeliveryDate
      ? new Date(this.editDeliveryDate)
      : null;

    this.editingDeliveryGroup.sales.forEach((sale: Sale) => {
      const updatedSale: Sale = {
        ...sale,
        deliveryDate: newDate || sale.deliveryDate,
        deliveryNotes: this.editDeliveryNotes,
      };
      this.inventoryService.updateSale(updatedSale);
    });

    this.closeEditDeliveryModal();
  }

  // Print/Reprint receipt for a completed sale
  closeReceiptPreview(): void {
    this.isReceiptPreviewOpen = false;
  }

  async reprintReceipt(sale: Sale): Promise<void> {
    // 1. Find all items in the same order if orderId exists
    let orderItems: Sale[] = [sale];
    if (sale.orderId) {
      orderItems = this.salesSignal().filter((s) => s.orderId === sale.orderId);
    }

    const store = this.storeService.stores().find((s) => s.id === sale.storeId);

    // 2. Build receipt data
    this.lastReceiptData = {
      storeName: store?.name || 'JJM Store',
      storeAddress: store?.address,
      storePhone: store?.phoneNumber,
      orderId: sale.orderId || sale.id?.slice(-8) || 'N/A',
      date:
        sale.timestamp instanceof Date
          ? sale.timestamp
          : new Date(sale.timestamp),
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

    // 3. Open preview modal
    this.isReceiptPreviewOpen = true;
  }

  onDeleteSale(sale: Sale): void {
    this.dialogService
      .confirm(
        `Are you sure you want to delete the sale for ${sale.productName}? This will remove it from history and restore stock.`,
        'Delete Sale'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.inventoryService.deleteSale(sale.id);
          this.dialogService.success('Sale deleted successfully', 'Deleted');
        }
      });
  }

  /**
   * Delete all sales in a grouped order
   */
  onDeleteGroupedSale(group: any): void {
    const itemCount = group.sales?.length || 1;
    const message =
      itemCount > 1
        ? `Are you sure you want to delete this order with ${itemCount} items? This will remove all items and restore stock.`
        : `Are you sure you want to delete this sale? This will remove it from history and restore stock.`;

    this.dialogService
      .confirm(message, 'Delete Order')
      .subscribe((confirmed) => {
        if (confirmed) {
          // Delete all sales in the group
          group.sales.forEach((sale: Sale) => {
            this.inventoryService.deleteSale(sale.id);
          });
          this.dialogService.success(
            itemCount > 1
              ? `Order with ${itemCount} items deleted`
              : 'Sale deleted successfully',
            'Deleted'
          );
        }
      });
  }

  async printFromPreview(): Promise<void> {
    if (!this.printService.isConnected()) {
      this.dialogService.warning(
        'Printer not connected. Please connect a Bluetooth printer first.',
        'Printer Not Connected'
      );
      return;
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

  async connectPrinter(): Promise<void> {
    try {
      await this.printService.connectPrinter();
      this.dialogService.success(
        'Printer connected successfully!',
        'Connected'
      );
    } catch (error: any) {
      this.dialogService.error(
        error.message || 'Failed to connect printer',
        'Connection Error'
      );
    }
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
    }).format(value);
  }
}
