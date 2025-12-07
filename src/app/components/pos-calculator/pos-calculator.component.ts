import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { CustomerService } from '../../services/customer.service';
import { Product, Customer, Sale } from '../../models/inventory.models';

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

  // Delivery scheduling fields
  deliveryDate: string = '';
  deliveryTime: string = '';
  deliveryNotes: string = '';
  minDate: string = '';

  // Filter for pending deliveries
  deliveryFilterDate: string = '';

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

  get subtotal(): number {
    return this.selectedProduct
      ? this.selectedProduct.price * this.quantity
      : 0;
  }

  get total(): number {
    let t = this.subtotal;
    if (this.discount > 0) {
      if (this.discountType === 'percent') {
        t = t - t * (this.discount / 100);
      } else {
        t = t - this.discount;
      }
    }
    return Math.max(0, Math.round(t * 100) / 100);
  }

  get change(): number {
    return this.cashReceived - this.total;
  }

  get maxQuantity(): number {
    return this.selectedProduct?.quantity || 0;
  }

  onProductChange(): void {
    this.quantity = 1;
    this.errorMessage = '';
    this.discount = 0;
  }

  processSale(): void {
    this.errorMessage = '';
    if (!this.selectedProductId) {
      this.errorMessage = 'Please select a product';
      return;
    }
    if (this.quantity < 1 || this.quantity > this.maxQuantity) {
      this.errorMessage = `Quantity must be between 1 and ${this.maxQuantity}`;
      return;
    }
    if (this.cashReceived < this.total) {
      this.errorMessage = 'Insufficient cash received';
      return;
    }
    try {
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
        this.selectedProductId,
        this.quantity,
        this.cashReceived,
        deliveryDateObj,
        this.deliveryNotes || undefined,
        this.selectedCustomerId || undefined,
        this.discount,
        this.discountType
      );
      // Reset form
      this.selectedProductId = '';
      this.quantity = 1;
      this.cashReceived = 0;
      this.discount = 0;
      this.discountType = 'amount';
      this.deliveryDate = this.minDate;
      this.deliveryTime = '';
      this.deliveryNotes = '';
    } catch (error: any) {
      this.errorMessage = error.message || 'Error processing sale';
    }
  }

  isValid(): boolean {
    return !!(
      this.selectedProductId &&
      this.quantity >= 1 &&
      this.quantity <= this.maxQuantity &&
      this.cashReceived >= this.total
    );
  }

  markAsDelivered(saleId: string): void {
    if (confirm('Are you sure you want to mark this item as delivered?')) {
      this.inventoryService.completePendingSale(saleId);
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
}
