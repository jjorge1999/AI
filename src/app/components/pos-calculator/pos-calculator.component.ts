import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  Input,
  computed,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { Router } from '@angular/router';
import { CustomerService } from '../../services/customer.service';
import { Product, Customer, Sale } from '../../models/inventory.models';
import { DialogService } from '../../services/dialog.service';
import { PrintService, ReceiptData } from '../../services/print.service';
import { StoreService } from '../../services/store.service';
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
  // State using Signals from Services
  allProducts = this.inventoryService.products;
  customers = this.customerService.customers;
  sales = this.inventoryService.sales;
  categoriesSignal = this.inventoryService.categories;
  stores = this.storeService.stores;

  // Derived state using Computed
  products = computed(() =>
    this.allProducts().filter((p: Product) => p.quantity > 0)
  );

  pendingSales = computed(() =>
    this.sales().filter((s: Sale) => s.pending === true)
  );

  allGroupedSales: any[] = [];
  isPendingCollapsed = false;

  // Category filtering
  categories = computed(() =>
    this.categoriesSignal()
      .map((c: any) => c.name)
      .sort()
  );
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

  // Bluetooth Printer State
  printerStatus$ = this.printService.connectionStatus$;
  printerName$ = this.printService.deviceName$;
  isPrintModalOpen = false;
  isPrinting = false;
  lastReceiptData: ReceiptData | null = null;
  isReceiptPreviewOpen = false;
  activeStore: any = null;

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
    private printService: PrintService,
    private storeService: StoreService,
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

    // Load data if not already present (SWR behavior)
    this.customerService.loadCustomers();

    // Set up logic for Signal changes
    // We update allGroupedSales when sales signal changes
    effect(() => {
      const currentSales = this.sales();
      if (currentSales) {
        this.updateGroupedSales();
        if (!this.checkInterval) {
          this.startAlarmChecks();
        }
      }
    });

    // Initial store setup
    const activeStoreId = this.storeService.getActiveStoreId();
    if (activeStoreId) {
      this.activeStore = this.stores().find((s) => s.id === activeStoreId);
    }

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
    let filtered = this.pendingSales();

    // Status Filter
    if (this.statusFilter === 'reservation') {
      filtered = filtered.filter(
        (s: Sale) => s.reservationStatus === 'pending_confirmation'
      );
    }

    if (this.deliveryFilterDate) {
      filtered = filtered.filter((s: Sale) => {
        if (!s.deliveryDate) return false;
        const d = new Date(s.deliveryDate);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        return dateStr === this.deliveryFilterDate;
      });
    }
    return filtered.slice().sort((a: Sale, b: Sale) => {
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

    this.pendingSales().forEach((sale: Sale) => {
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
    return this.products().find(
      (p: Product) => p.id === this.selectedProductId
    );
  }

  get selectedCustomer(): Customer | undefined {
    return this.customers().find(
      (c: Customer) => c.id === this.selectedCustomerId
    );
  }

  getCustomerById(customerId: string | undefined): Customer | undefined {
    if (!customerId) return undefined;
    return this.customers().find((c: Customer) => c.id === customerId);
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

    // Build receipt data before clearing cart
    const cartSnapshot = [...this.cart];
    const cashSnapshot = this.cashReceived;
    const totalSnapshot = this.total;
    const customerName = this.selectedCustomer?.name;
    let deliveryDateObj: Date | undefined;
    if (this.deliveryDate) {
      if (this.deliveryTime) {
        deliveryDateObj = new Date(`${this.deliveryDate}T${this.deliveryTime}`);
      } else {
        deliveryDateObj = new Date(this.deliveryDate);
      }
    }

    const saleObservables = this.cart.map((item, index) => {
      let itemCashReceived = item.total;
      if (index === 0) {
        itemCashReceived += totalChange;
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
        // Prepare receipt data for printing with store details
        this.lastReceiptData = {
          storeName: this.activeStore?.name || 'JJM Inventory',
          storeAddress: this.activeStore?.address || '',
          storePhone: this.activeStore?.phoneNumber || '',
          orderId: orderId,
          date: new Date(),
          items: cartSnapshot.map((item) => ({
            name: item.product.name,
            quantity: item.quantity,
            price: item.product.price,
            discount: item.discount,
            discountType: item.discountType,
            total: item.total,
          })),
          subtotal: totalSnapshot,
          totalDiscount: cartSnapshot.reduce((sum, item) => {
            if (item.discountType === 'percent') {
              return (
                sum + (item.product.price * item.quantity * item.discount) / 100
              );
            }
            return sum + item.discount;
          }, 0),
          total: totalSnapshot,
          cashReceived: cashSnapshot,
          change: totalChange,
          customerName: customerName,
          deliveryDate: deliveryDateObj,
          notes: this.deliveryNotes,
        };

        // Show receipt preview instead of auto-print
        this.isReceiptPreviewOpen = true;

        // Clear Cart
        this.cart = [];
        this.cashReceived = 0;
        this.cashDisplayValue = '';
        this.deliveryDate = this.minDate;
        this.deliveryTime = '';
        this.deliveryNotes = '';
        this.selectedCustomerId = '';
        this.errorMessage = '';

        this.dialogService.success(
          'Sale completed successfully!',
          'Checkout Complete'
        );
      },
      error: (error) => {
        this.errorMessage = error.message || 'Error processing sales';
      },
    });
  }

  // Bluetooth Printer Methods
  async connectPrinter(): Promise<void> {
    try {
      await this.printService.connectPrinter();
      this.dialogService.success(
        'Printer connected successfully!',
        'Bluetooth Printer'
      );
    } catch (error: any) {
      this.dialogService.error(
        error.message || 'Failed to connect to printer',
        'Connection Error'
      );
    }
  }

  disconnectPrinter(): void {
    this.printService.disconnectPrinter();
  }

  forgetPrinter(): void {
    this.printService.forgetPrinter();
  }

  async printReceipt(): Promise<void> {
    if (!this.lastReceiptData) {
      this.dialogService.warning('No receipt data available', 'Print Error');
      return;
    }

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

  async printTestPage(): Promise<void> {
    if (!this.printService.isConnected()) {
      this.dialogService.warning('Printer not connected', 'Print Error');
      return;
    }

    this.isPrinting = true;
    try {
      await this.printService.printTestPage();
      this.dialogService.success('Test page printed!', 'Print Complete');
    } catch (error: any) {
      this.dialogService.error(
        error.message || 'Failed to print test page',
        'Print Error'
      );
    } finally {
      this.isPrinting = false;
    }
  }

  openPrintModal(): void {
    this.isPrintModalOpen = true;
  }

  closePrintModal(): void {
    this.isPrintModalOpen = false;
  }

  // Receipt Preview Modal Methods
  closeReceiptPreview(): void {
    this.isReceiptPreviewOpen = false;
  }

  openReceiptPreview(): void {
    // Generate preview from current cart if available
    if (this.cart.length > 0) {
      const customerName = this.selectedCustomer?.name;
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

      // Build preview receipt data from current cart
      this.lastReceiptData = {
        storeName: this.activeStore?.name || 'JJM Inventory',
        storeAddress: this.activeStore?.address || '',
        storePhone: this.activeStore?.phoneNumber || '',
        orderId: '(Preview)',
        date: new Date(),
        items: this.cart.map((item) => ({
          name: item.product.name,
          quantity: item.quantity,
          price: item.product.price,
          discount: item.discount,
          discountType: item.discountType,
          total: item.total,
        })),
        subtotal: this.total,
        totalDiscount: this.cart.reduce((sum, item) => {
          if (item.discountType === 'percent') {
            return (
              sum + (item.product.price * item.quantity * item.discount) / 100
            );
          }
          return sum + item.discount;
        }, 0),
        total: this.total,
        cashReceived: this.cashReceived || 0,
        change: Math.max(0, (this.cashReceived || 0) - this.total),
        customerName: customerName,
        deliveryDate: deliveryDateObj,
        notes: this.deliveryNotes,
      };
      this.isReceiptPreviewOpen = true;
    } else if (this.lastReceiptData) {
      // Show last completed receipt if cart is empty
      this.isReceiptPreviewOpen = true;
    } else {
      this.dialogService.info(
        'Add items to cart to preview the receipt.',
        'Cart Empty'
      );
    }
  }

  async printFromPreview(): Promise<void> {
    if (!this.printService.isConnected()) {
      // Close preview and open printer modal to connect
      this.isReceiptPreviewOpen = false;
      this.isPrintModalOpen = true;
      this.dialogService.warning(
        'Please connect a Bluetooth printer first.',
        'Printer Not Connected'
      );
      return;
    }

    await this.printReceipt();
    this.isReceiptPreviewOpen = false;
  }

  // Reprint receipt for a pending delivery order
  reprintOrderReceipt(group: any): void {
    if (!group || !group.sales || group.sales.length === 0) {
      this.dialogService.warning('No order data available', 'Reprint Error');
      return;
    }

    // Build receipt data from the grouped order
    this.lastReceiptData = {
      storeName: this.activeStore?.name || 'JJM Inventory',
      storeAddress: this.activeStore?.address || '',
      storePhone: this.activeStore?.phoneNumber || '',
      orderId: group.orderId || group.sales[0]?.id || 'N/A',
      date: group.timestamp || new Date(),
      items: group.sales.map((sale: any) => ({
        name: sale.productName,
        quantity: sale.quantitySold,
        price: sale.price,
        discount: sale.discount || 0,
        discountType: sale.discountType || 'amount',
        total: sale.total,
      })),
      subtotal: group.total,
      totalDiscount: group.discount || 0,
      total: group.total,
      cashReceived: group.cashReceived || 0,
      change: group.change || 0,
      customerName: group.customer?.name,
      deliveryDate: group.deliveryDate,
      notes: group.deliveryNotes,
    };

    this.isReceiptPreviewOpen = true;
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
      const salesToUpdate = this.pendingSales().filter(
        (s: Sale) => s.orderId === orderId
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
      return this.products();
    }
    return this.products().filter(
      (p: Product) => p.category === this.categoryFilter
    );
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
