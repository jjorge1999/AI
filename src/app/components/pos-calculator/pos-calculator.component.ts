import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { CustomerService } from '../../services/customer.service';
import { Product, Customer, Sale } from '../../models/inventory.models';

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
export class PosCalculatorComponent implements OnInit {
  // Data collections
  products: Product[] = [];
  customers: Customer[] = [];
  pendingSales: Sale[] = [];

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

  constructor(
    private inventoryService: InventoryService,
    private customerService: CustomerService
  ) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    this.minDate = `${year}-${month}-${day}`;
    this.deliveryDate = this.minDate;
  }

  ngOnInit(): void {
    this.inventoryService.getProducts().subscribe((products) => {
      this.products = products.filter((p) => p.quantity > 0);
    });
    this.customerService.getCustomers().subscribe((customers) => {
      this.customers = customers;
    });
    this.inventoryService.getSales().subscribe((sales) => {
      this.pendingSales = sales.filter((s) => s.pending === true);
      this.startAlarmChecks();
    });
    this.discount = 0;
  }

  private startAlarmChecks(): void {
    // Check every hour
    setInterval(() => this.checkPendingDeliveryAlarms(), 60 * 60 * 1000);
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
    this.pendingSales.forEach((sale) => {
      if (!sale.deliveryDate) return;
      const delivery = new Date(sale.deliveryDate);
      const diffMs = delivery.getTime() - now.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 1 || diffDays === 2) {
        this.triggerAlarm(sale, diffDays);
      }
    });
  }

  private triggerAlarm(sale: Sale, daysAhead: number): void {
    const deliveryDate = new Date(sale.deliveryDate as any);
    const dateStr = deliveryDate.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const message = `⚠️ Delivery for "${sale.productName}" is due in ${daysAhead} day(s) (${dateStr}).`;
    this.playBeep();
    alert(message);
  }

  private playBeep(): void {
    try {
      const ctx = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(1000, ctx.currentTime);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 2);
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

  get groupedPendingSales(): any[] {
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
      });
    });

    // Sort by Date/Status priority same as before
    return result.sort((a, b) => {
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

    try {
      // Process items one by one
      this.cart.forEach((item, index) => {
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

        this.inventoryService.recordSale(
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

      // Clear Cart
      this.cart = [];
      this.cashReceived = 0;
      this.deliveryDate = this.minDate;
      this.deliveryTime = '';
      this.deliveryNotes = '';
      this.selectedCustomerId = '';
      this.errorMessage = '';
    } catch (error: any) {
      this.errorMessage = error.message || 'Error processing sales';
    }
  }

  markAsDelivered(saleId: string): void {
    if (confirm('Are you sure you want to mark this item as delivered?')) {
      this.inventoryService.completePendingSale(saleId);
    }
  }

  confirmReservation(sale: Sale): void {
    if (
      confirm(
        'Confirming this reservation will deduct items from inventory. Continue?'
      )
    ) {
      this.inventoryService.confirmReservation(sale);
    }
  }

  deleteReservation(sale: Sale): void {
    if (confirm('Are you sure you want to remove this reservation?')) {
      this.inventoryService.deleteSale(sale.id);
    }
  }

  openEditModal(sale: Sale): void {
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
    const updatedSale: Sale = {
      ...this.editingSale,
      deliveryDate: newDeliveryDate,
      deliveryNotes: this.editDeliveryNotes,
    };
    this.inventoryService.updateSale(updatedSale);
    this.closeEditModal();
  }

  markGroupAsDelivered(sales: Sale[]): void {
    if (confirm(`Mark ${sales.length} items as delivered?`)) {
      sales.forEach((s) => this.inventoryService.completePendingSale(s.id));
    }
  }

  confirmGroupReservation(sales: Sale[]): void {
    if (
      confirm(
        `Confirm reservation for ${sales.length} items? This will deduct stock upon delivery.`
      )
    ) {
      sales.forEach((s) => this.inventoryService.confirmReservation(s));
    }
  }

  cancelGroupReservation(sales: Sale[]): void {
    if (confirm(`Cancel reservation for ${sales.length} items?`)) {
      sales.forEach((s) => this.inventoryService.deleteSale(s.id));
    }
  }
}
