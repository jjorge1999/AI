import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  Input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { Router } from '@angular/router';
import { CustomerService } from '../../services/customer.service';
import { Product, Customer, Sale } from '../../models/inventory.models';
import { DialogService } from '../../services/dialog.service';
import { Subscription, forkJoin } from 'rxjs';

interface CartItem {
  product: Product;
  quantity: number;
  discount: number;
  discountType: 'amount' | 'percent';
  total: number;
}

@Component({
  selector: 'app-pos-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos-calculator.component.html',
  styleUrl: './pos-calculator.component.css',
})
export class PosCalculatorComponent implements OnInit, OnDestroy {
  // Data collections
  products: Product[] = [];
  allProducts: Product[] = [];
  customers: Customer[] = [];
  pendingSales: Sale[] = [];
  allGroupedSales: any[] = [];
  isPendingCollapsed = false;

  // Category filtering
  categories: string[] = [];
  categoryFilter: string = '';

  // New UI state
  isPendingPanelOpen = false;
  isDeliveryModalOpen = false;
  isDiscountModalOpen = false;
  isNotesModalOpen = false;
  orderNumber = 1000 + Math.floor(Math.random() * 9000);
  currentDate = new Date();
  currentTime = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Discount modal temp values
  tempDiscount = 0;
  tempDiscountType: 'amount' | 'percent' = 'amount';

  @Input() initialPendingOpen = false;

  togglePending(): void {
    this.isPendingCollapsed = !this.isPendingCollapsed;
  }

  private subscriptions: Subscription = new Subscription();

  // Form state
  selectedProductId = '';
  selectedCustomerId = '';
  quantity = 1;
  cashReceived = 0;
  discount = 0;
  discountType: 'amount' | 'percent' = 'amount';
  errorMessage = '';

  // Cart
  cart: CartItem[] = [];

  // Delivery scheduling fields
  deliveryDate: string = '';
  deliveryTime: string = '';
  deliveryNotes: string = '';
  minDate: string = '';

  // Filter for pending deliveries
  deliveryFilterDate: string = '';
  statusFilter: 'all' | 'reservation' = 'all';

  // Edit modal state
  isEditModalOpen = false;
  editingSale: Sale | null = null;
  editDeliveryDate: string = '';
  editDeliveryTime: string = '';
  editDeliveryNotes: string = '';

  // Quantity modal state
  isQuantityModalOpen = false;
  quantityModalIndex: number = -1;
  quantityModalValue: number = 1;
  quantityModalMax: number = 1;

  // Pagination for Pending Deliveries
  pendingPage: number = 1;
  pendingPageSize: number = 5;
  pendingPageSizeOptions: number[] = [5, 10, 20, 50];

  // Alarm state
  private alarmInterval: any = null;
  private checkInterval: any = null;

  // Audio Context State
  private audioCtx: any = null;
  private audioUnlocked = false;

  // Cash Formatting
  cashDisplayValue: string = '';

  onCashInput(value: string): void {
    // Save current display value (user typing)
    this.cashDisplayValue = value;

    // Parse for logic (remove commas, spaces, '₱')
    const raw = value.replace(/[^0-9.]/g, '');
    this.cashReceived = parseFloat(raw);

    if (isNaN(this.cashReceived)) {
      this.cashReceived = 0;
    }
  }

  formatCashOnBlur(): void {
    if (this.cashReceived !== 0) {
      this.cashDisplayValue = this.cashReceived.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } else {
      this.cashDisplayValue = '';
    }
  }

  unformatCashOnFocus(): void {
    if (this.cashReceived !== 0) {
      this.cashDisplayValue = this.cashReceived.toString();
    } else {
      this.cashDisplayValue = '';
    }
  }

  constructor(
    private inventoryService: InventoryService,
    private customerService: CustomerService,
    private dialogService: DialogService,
    private router: Router
  ) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    this.minDate = `${year}-${month}-${day}`;
    this.deliveryDate = this.minDate;
    this.deliveryTime = '10:00'; // Default to 10:00 AM
  }

  ngOnInit(): void {
    const state = history.state;
    if (this.initialPendingOpen || (state && state.initialPendingOpen)) {
      this.isPendingPanelOpen = true;
    }

    // Load customers for selection and name resolution
    this.customerService.loadCustomers();

    this.subscriptions.add(
      this.inventoryService.getProducts().subscribe((products) => {
        this.allProducts = products;
        this.products = products.filter((p) => p.quantity > 0);
        // Extract categories
        const cats = new Set(products.map((p) => p.category));
        this.categories = Array.from(cats)
          .filter((c) => c)
          .sort();
      })
    );
    this.subscriptions.add(
      this.customerService.getCustomers().subscribe((customers) => {
        this.customers = customers;
      })
    );
    this.subscriptions.add(
      this.inventoryService.getSales().subscribe((sales) => {
        this.pendingSales = sales.filter((s) => s.pending === true);
        this.updateGroupedSales();
        // Only start if not already started? or re-check. Logic is fine here.
        if (!this.checkInterval) {
          this.startAlarmChecks();
        }
      })
    );
    this.discount = 0;
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.stopAlarm();
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
    }
  }

  @HostListener('document:click')
  @HostListener('document:touchstart')
  @HostListener('document:keydown')
  onUserInteraction() {
    this.unlockAudioContext();
  }

  private unlockAudioContext() {
    if (this.audioUnlocked) return;

    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
    }
    const ctx = this.audioCtx;
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      // Play silent buffer to unlock
      try {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        this.audioUnlocked = true;
      } catch (e) {
        // ignore
      }
    }
  }

  private startAlarmChecks(): void {
    // Check every hour
    this.checkInterval = setInterval(
      () => this.checkPendingDeliveryAlarms(),
      60 * 60 * 1000
    );
    // Also run immediately
    this.checkPendingDeliveryAlarms();
  }

  /** Returns pending sales filtered by selected delivery date (if any) and sorted by delivery date */
  get filteredPendingSales(): Sale[] {
    let filtered = this.pendingSales;

    // Status Filter
    if (this.statusFilter === 'reservation') {
      filtered = filtered.filter(
        (s) => s.reservationStatus === 'pending_confirmation'
      );
    }

    if (this.deliveryFilterDate) {
      filtered = filtered.filter((s) => {
        if (!s.deliveryDate) return false;
        const d = new Date(s.deliveryDate);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        return dateStr === this.deliveryFilterDate;
      });
    }
    return filtered.slice().sort((a, b) => {
      // Sort priority: Pending Confirmations FIRST
      const aReserved = a.reservationStatus === 'pending_confirmation';
      const bReserved = b.reservationStatus === 'pending_confirmation';

      if (aReserved && !bReserved) return -1;
      if (!aReserved && bReserved) return 1;

      const aTime = a.deliveryDate
        ? new Date(a.deliveryDate).getTime()
        : Infinity;
      const bTime = b.deliveryDate
        ? new Date(b.deliveryDate).getTime()
        : Infinity;
      return aTime - bTime;
    });
  }

  private checkPendingDeliveryAlarms(): void {
    const now = new Date();
    const dueSales: { sale: Sale; days: number }[] = [];

    this.pendingSales.forEach((sale) => {
      if (!sale.deliveryDate) return;
      const delivery = new Date(sale.deliveryDate);
      const diffMs = delivery.getTime() - now.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      // Check for approaching (1 or 2 days) or overdue/today (< 1)
      if (diffDays === 1 || diffDays === 2 || diffDays < 0) {
        dueSales.push({ sale, days: diffDays });
      }
    });

    if (dueSales.length > 0) {
      this.triggerBatchAlarm(dueSales);
    }
  }

  private triggerBatchAlarm(dueItems: { sale: Sale; days: number }[]): void {
    // Prevent multiple alarms if one is already active
    if (this.alarmInterval) return;

    let message = '';
    if (dueItems.length === 1) {
      const item = dueItems[0];
      const deliveryDate = new Date(item.sale.deliveryDate as any);
      const dateStr = deliveryDate.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

      if (item.days < 0) {
        message = `⚠️ OVERDUE: Delivery for "${item.sale.productName}" was due on ${dateStr}.`;
      } else if (item.days === 0) {
        message = `⚠️ TODAY: Delivery for "${item.sale.productName}" is due today!`;
      } else {
        message = `⚠️ UPCOMING: Delivery for "${item.sale.productName}" is due in ${item.days} day(s) (${dateStr}).`;
      }
    } else {
      message = `⚠️ There are ${dueItems.length} deliveries due soon or overdue. Please check the Pending Deliveries list.`;
    }

    this.playLoopingAlarm();

    this.dialogService
      .alert(message, 'Delivery Reminder', 'warning')
      .subscribe(() => {
        this.stopAlarm();
      });
  }

  private playLoopingAlarm(): void {
    // Stop any existing alarm first
    this.stopAlarm();

    // Play immediately
    this.playBeep();

    // Then repeat every 2 seconds
    this.alarmInterval = setInterval(() => {
      this.playBeep();
    }, 2000);
  }

  private stopAlarm(): void {
    if (this.alarmInterval) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
  }

  private playBeep(): void {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
      }

      const ctx = this.audioCtx;

      // If suspended (common on autorefresh), wait for interaction.
      // Do not force resume as it triggers warnings.
      // @HostListener will handle unlocking.
      if (ctx.state === 'suspended') {
        return;
      }

      // Create two oscillators for a pleasant harmony
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      // Use sine wave for smooth sound
      osc1.type = 'sine';
      osc2.type = 'sine';

      // Pleasant frequencies (C and E notes)
      osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc2.frequency.setValueAtTime(659.25, ctx.currentTime); // E5

      // Connect oscillators to gain
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      // Smooth envelope: gentle fade in and fade out
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05); // Gentle start
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.4); // Hold
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8); // Smooth fade out

      // Play the sound
      osc1.start(ctx.currentTime);
      osc2.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.8);
      osc2.stop(ctx.currentTime + 0.8);
    } catch (e) {
      console.error('Audio alarm failed', e);
    }
  }

  get selectedProduct(): Product | undefined {
    return this.products.find((p) => p.id === this.selectedProductId);
  }

  get selectedCustomer(): Customer | undefined {
    return this.customers.find((c) => c.id === this.selectedCustomerId);
  }

  getCustomerById(customerId: string | undefined): Customer | undefined {
    if (!customerId) return undefined;
    return this.customers.find((c) => c.id === customerId);
  }

  get maxQuantity(): number {
    return this.selectedProduct?.quantity || 0;
  }

  onProductChange(): void {
    this.quantity = 1;
    this.errorMessage = '';
    this.discount = 0;
  }

  addToCart(): void {
    this.errorMessage = '';
    if (!this.selectedProduct) {
      this.errorMessage = 'Please select a product';
      return;
    }
    if (this.quantity < 1 || this.quantity > this.maxQuantity) {
      this.errorMessage = `Quantity must be between 1 and ${this.maxQuantity}`;
      return;
    }

    // Check if adding exceeds stock (considering items already in cart)
    const existingInCart = this.cart
      .filter((i) => i.product.id === this.selectedProduct!.id)
      .reduce((sum, i) => sum + i.quantity, 0);

    if (existingInCart + this.quantity > this.maxQuantity) {
      this.errorMessage = `Cannot add more. Total in cart (${existingInCart}) + new (${this.quantity}) exceeds stock (${this.maxQuantity})`;
      return;
    }

    let itemTotal = this.selectedProduct.price * this.quantity;
    if (this.discount > 0) {
      if (this.discountType === 'percent') {
        itemTotal = itemTotal - itemTotal * (this.discount / 100);
      } else {
        itemTotal = itemTotal - this.discount;
      }
    }
    itemTotal = Math.max(0, Math.round(itemTotal * 100) / 100);

    this.cart.push({
      product: this.selectedProduct,
      quantity: this.quantity,
      discount: this.discount,
      discountType: this.discountType,
      total: itemTotal,
    });

    // Reset selection
    this.quantity = 1;
    this.discount = 0;
    this.discountType = 'amount';
    this.selectedProductId = ''; // Reset product selection
  }

  removeFromCart(index: number): void {
    this.cart.splice(index, 1);
  }

  get total(): number {
    return this.cart.reduce((sum, item) => sum + item.total, 0);
  }

  get change(): number {
    return this.cashReceived - this.total;
  }

  isValid(): boolean {
    return this.cart.length > 0 && this.cashReceived >= this.total;
  }

  updateGroupedSales(): void {
    const groups = new Map<string, Sale[]>();
    const singles: Sale[] = [];

    this.filteredPendingSales.forEach((sale) => {
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
      result.push({
        isGroup: true,
        orderId: orderId,
        sales: sales,
        total: sales.reduce((sum, s) => sum + s.total, 0),
        customerName: this.getCustomerById(first.customerId)?.name || 'Walk-in',
        customer: this.getCustomerById(first.customerId),
        deliveryDate: first.deliveryDate,
        timestamp: first.timestamp,
        status: first.reservationStatus,
        productNames: sales.map((s) => s.productName).join(', '),
        deliveryNotes: first.deliveryNotes,
        quantityTotal: sales.reduce((sum, s) => sum + s.quantitySold, 0),
        // Payment details from first sale (shared across group)
        discount: first.discount,
        discountType: first.discountType,
        cashReceived: first.cashReceived,
        change: first.change,
      });
    });

    // Process Singles
    singles.forEach((sale) => {
      result.push({
        isGroup: false,
        id: sale.id,
        sales: [sale],
        total: sale.total,
        customerName: this.getCustomerById(sale.customerId)?.name || 'Walk-in',
        customer: this.getCustomerById(sale.customerId),
        deliveryDate: sale.deliveryDate,
        timestamp: sale.timestamp,
        status: sale.reservationStatus,
        productNames: sale.productName,
        deliveryNotes: sale.deliveryNotes,
        quantityTotal: sale.quantitySold,
        // Payment details
        discount: sale.discount,
        discountType: sale.discountType,
        cashReceived: sale.cashReceived,
        change: sale.change,
      });
    });

    // Sort by Date/Status priority same as before
    this.allGroupedSales = result.sort((a, b) => {
      const aReserved = a.status === 'pending_confirmation';
      const bReserved = b.status === 'pending_confirmation';

      if (aReserved && !bReserved) return -1;
      if (!aReserved && bReserved) return 1;

      const aTime = a.deliveryDate
        ? new Date(a.deliveryDate).getTime()
        : Infinity;
      const bTime = b.deliveryDate
        ? new Date(b.deliveryDate).getTime()
        : Infinity;
      return aTime - bTime;
    });

    // Ensure page is valid
    if (this.pendingPage > this.pendingTotalPages && this.pendingPage > 1) {
      this.pendingPage = 1;
    }
  }

  get paginatedGroupedPendingSales(): any[] {
    const startIndex = (this.pendingPage - 1) * this.pendingPageSize;
    return this.allGroupedSales.slice(
      startIndex,
      startIndex + this.pendingPageSize
    );
  }

  get pendingTotalPages(): number {
    return Math.ceil(this.allGroupedSales.length / this.pendingPageSize);
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

  getPendingPageNumbers(): number[] {
    return Array(this.pendingTotalPages)
      .fill(0)
      .map((x, i) => i + 1);
  }

  clearFilter(): void {
    this.deliveryFilterDate = '';
    this.statusFilter = 'all';
    this.pendingPage = 1; // Reset to page 1
    this.updateGroupedSales();
  }

  checkout(): void {
    this.errorMessage = '';
    if (this.cart.length === 0) {
      this.errorMessage = 'Cart is empty';
      return;
    }
    if (this.cashReceived < this.total) {
      this.errorMessage = 'Insufficient cash received';
      return;
    }

    const totalChange = this.cashReceived - this.total;
    const orderId =
      'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

    const saleObservables = this.cart.map((item, index) => {
      // Assign the total change to the FIRST item transaction
      let itemCashReceived = item.total;
      if (index === 0) {
        itemCashReceived += totalChange;
      }

      let deliveryDateObj: Date | undefined;
      if (this.deliveryDate) {
        if (this.deliveryTime) {
          deliveryDateObj = new Date(
            `${this.deliveryDate}T${this.deliveryTime}`
          );
        } else {
          deliveryDateObj = new Date(this.deliveryDate);
        }
      }

      return this.inventoryService.recordSale(
        item.product.id,
        item.quantity,
        itemCashReceived,
        deliveryDateObj,
        this.deliveryNotes || undefined,
        this.selectedCustomerId || undefined,
        item.discount,
        item.discountType,
        orderId
      );
    });

    forkJoin(saleObservables).subscribe({
      next: () => {
        // Clear Cart
        this.cart = [];
        this.cashReceived = 0;
        this.deliveryDate = this.minDate;
        this.deliveryTime = '';
        this.deliveryNotes = '';
        this.selectedCustomerId = '';
        this.errorMessage = '';
      },
      error: (error) => {
        this.errorMessage = error.message || 'Error processing sales';
      },
    });
  }

  markAsDelivered(saleId: string): void {
    this.dialogService
      .confirm(
        'Are you sure you want to mark this item as delivered?',
        'Mark as Delivered'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.inventoryService.completePendingSale(saleId);
        }
      });
  }

  confirmReservation(sale: Sale): void {
    this.dialogService
      .confirm(
        'Confirming this reservation will deduct items from inventory. Continue?',
        'Confirm Reservation'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.inventoryService.confirmReservation(sale);
        }
      });
  }

  deleteReservation(sale: Sale): void {
    this.dialogService
      .confirm(
        'Are you sure you want to remove this reservation?',
        'Remove Reservation'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.inventoryService.deleteSale(sale.id);
        }
      });
  }

  openEditModal(sale: Sale | undefined): void {
    if (!sale) return;
    this.editingSale = sale;
    this.isEditModalOpen = true;
    if (sale.deliveryDate) {
      const dateObj = new Date(sale.deliveryDate);
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      this.editDeliveryDate = `${year}-${month}-${day}`;
      this.editDeliveryTime = dateObj.toTimeString().substring(0, 5);
    } else {
      this.editDeliveryDate = '';
      this.editDeliveryTime = '';
    }
    this.editDeliveryNotes = sale.deliveryNotes || '';
  }

  closeEditModal(): void {
    this.isEditModalOpen = false;
    this.editingSale = null;
    this.editDeliveryDate = '';
    this.editDeliveryTime = '';
    this.editDeliveryNotes = '';
  }

  saveEdit(): void {
    if (!this.editingSale) return;
    let newDeliveryDate: Date | undefined;
    if (this.editDeliveryDate) {
      if (this.editDeliveryTime) {
        newDeliveryDate = new Date(
          `${this.editDeliveryDate}T${this.editDeliveryTime}`
        );
      } else {
        newDeliveryDate = new Date(this.editDeliveryDate);
      }
    }

    const orderId = this.editingSale.orderId;

    if (orderId) {
      // Update ALL sales in this order
      const salesToUpdate = this.pendingSales.filter(
        (s) => s.orderId === orderId
      );
      salesToUpdate.forEach((s) => {
        const updatedSale: Sale = {
          ...s,
          deliveryDate: newDeliveryDate,
          deliveryNotes: this.editDeliveryNotes,
        };
        this.inventoryService.updateSale(updatedSale);
      });
    } else {
      const updatedSale: Sale = {
        ...this.editingSale,
        deliveryDate: newDeliveryDate,
        deliveryNotes: this.editDeliveryNotes,
      };
      this.inventoryService.updateSale(updatedSale);
    }
    this.closeEditModal();
  }

  markGroupAsDelivered(sales: Sale[] | undefined): void {
    if (!sales || sales.length === 0) return;
    this.dialogService
      .confirm(
        `Mark ${sales.length} items as delivered? This will deduct stock and complete the order.`,
        'Mark Group as Delivered'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          sales.forEach((s) => this.inventoryService.completePendingSale(s.id));
        }
      });
  }

  confirmGroupReservation(sales: Sale[] | undefined): void {
    if (!sales || sales.length === 0) return;
    this.dialogService
      .confirm(
        `Confirm reservation for ${sales.length} items? This will deduct stock upon delivery.`,
        'Confirm Group Reservation'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          sales.forEach((s) => this.inventoryService.confirmReservation(s));
        }
      });
  }

  cancelGroupOrder(sales: Sale[] | undefined): void {
    if (!sales || sales.length === 0) return;
    this.dialogService
      .confirm(
        `Cancel order for ${sales.length} items? This cannot be undone.`,
        'Cancel Order'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          sales.forEach((s) => this.inventoryService.deleteSale(s.id));
        }
      });
  }

  // ========================================
  // New UI Methods
  // ========================================

  get filteredProducts(): Product[] {
    if (!this.categoryFilter) {
      return this.products;
    }
    return this.products.filter((p) => p.category === this.categoryFilter);
  }

  getCategoryIcon(category: string): string {
    const icons: { [key: string]: string } = {
      Lechon: 'restaurant',
      'Hollow blocks': 'construction',
      'Sand and Gravel': 'landscape',
      Copra: 'eco',
      Electronics: 'devices',
      Furniture: 'chair',
      'Hot Drinks': 'local_cafe',
      'Cold Drinks': 'ac_unit',
      Pastries: 'bakery_dining',
      Others: 'category',
    };
    return icons[category] || 'category';
  }

  isInCart(productId: string): boolean {
    return this.cart.some((item) => item.product.id === productId);
  }

  getCartQuantity(productId: string): number {
    return this.cart
      .filter((item) => item.product.id === productId)
      .reduce((sum, item) => sum + item.quantity, 0);
  }

  addProductToCart(product: Product): void {
    this.errorMessage = '';

    // Check if already in cart
    const existingIndex = this.cart.findIndex(
      (item) => item.product.id === product.id
    );
    if (existingIndex >= 0) {
      // Increment quantity
      const item = this.cart[existingIndex];
      if (item.quantity < product.quantity) {
        item.quantity++;
        item.total = this.calculateItemTotal(item);
      } else {
        this.errorMessage = `Cannot add more. Already at max stock (${product.quantity})`;
      }
      return;
    }

    // Add new item
    const newItem: CartItem = {
      product,
      quantity: 1,
      discount: 0,
      discountType: 'amount',
      total: product.price,
    };
    this.cart.push(newItem);
  }

  private calculateItemTotal(item: CartItem): number {
    let total = item.product.price * item.quantity;
    if (item.discount > 0) {
      if (item.discountType === 'percent') {
        total = total - total * (item.discount / 100);
      } else {
        total = total - item.discount;
      }
    }
    return Math.max(0, Math.round(total * 100) / 100);
  }

  incrementItem(index: number): void {
    const item = this.cart[index];
    if (item && item.quantity < item.product.quantity) {
      item.quantity++;
      item.total = this.calculateItemTotal(item);
    }
  }

  decrementItem(index: number): void {
    const item = this.cart[index];
    if (item) {
      if (item.quantity > 1) {
        item.quantity--;
        item.total = this.calculateItemTotal(item);
      } else {
        this.removeFromCart(index);
      }
    }
  }

  clearCart(): void {
    this.cart = [];
    this.cashReceived = 0;
    this.cashDisplayValue = '';
    this.errorMessage = '';
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  // Panel/Modal controls
  togglePendingPanel(): void {
    this.isPendingPanelOpen = !this.isPendingPanelOpen;
    if (this.isPendingPanelOpen) {
      this.updateGroupedSales();
    }
  }

  closePendingPanel(): void {
    this.isPendingPanelOpen = false;
  }

  openDeliveryModal(): void {
    this.isDeliveryModalOpen = true;
  }

  closeDeliveryModal(): void {
    this.isDeliveryModalOpen = false;
  }

  openDiscountModal(): void {
    this.tempDiscount = 0;
    this.tempDiscountType = 'amount';
    this.isDiscountModalOpen = true;
  }

  closeDiscountModal(): void {
    this.isDiscountModalOpen = false;
  }

  applyDiscount(): void {
    // Apply discount to all cart items proportionally
    if (this.cart.length > 0 && this.tempDiscount > 0) {
      const discountPerItem = this.tempDiscount / this.cart.length;
      this.cart.forEach((item) => {
        item.discount = discountPerItem;
        item.discountType = this.tempDiscountType;
        item.total = this.calculateItemTotal(item);
      });
    }
    this.closeDiscountModal();
  }

  openNotesModal(): void {
    this.isNotesModalOpen = true;
  }

  closeNotesModal(): void {
    this.isNotesModalOpen = false;
  }

  clearDelivery(): void {
    this.deliveryDate = '';
    this.deliveryTime = '';
    this.deliveryNotes = '';
  }

  // Quantity Modal Methods
  openQuantityModal(index: number): void {
    const item = this.cart[index];
    if (!item) return;

    this.quantityModalIndex = index;
    this.quantityModalValue = item.quantity;
    this.quantityModalMax = item.product.quantity;
    this.isQuantityModalOpen = true;
  }

  closeQuantityModal(): void {
    this.isQuantityModalOpen = false;
    this.quantityModalIndex = -1;
  }

  applyQuantity(): void {
    if (this.quantityModalIndex < 0) return;

    const item = this.cart[this.quantityModalIndex];
    if (!item) return;

    // Validate quantity
    let newQty = Math.floor(this.quantityModalValue);
    if (isNaN(newQty) || newQty < 1) {
      newQty = 1;
    } else if (newQty > this.quantityModalMax) {
      newQty = this.quantityModalMax;
    }

    item.quantity = newQty;
    item.total = this.calculateItemTotal(item);

    this.closeQuantityModal();
  }

  incrementModalQty(): void {
    if (this.quantityModalValue < this.quantityModalMax) {
      this.quantityModalValue++;
    }
  }

  decrementModalQty(): void {
    if (this.quantityModalValue > 1) {
      this.quantityModalValue--;
    }
  }

  setQuickQuantity(value: number): void {
    if (value <= this.quantityModalMax) {
      this.quantityModalValue = value;
    } else {
      this.quantityModalValue = this.quantityModalMax;
    }
  }
}
