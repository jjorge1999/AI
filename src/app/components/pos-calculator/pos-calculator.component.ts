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
  styleUrl: './pos-calculator.component.css'
})
export class PosCalculatorComponent implements OnInit {
  products: Product[] = [];
  customers: Customer[] = [];
  pendingSales: Sale[] = [];
  selectedProductId = '';
  selectedCustomerId = '';
  quantity = 1;
  cashReceived = 0;
  errorMessage = '';
  
  // Delivery scheduling
  deliveryDate: string = '';
  deliveryTime: string = '';
  deliveryNotes: string = '';
  minDate: string = '';

  constructor(
    private inventoryService: InventoryService,
    private customerService: CustomerService
  ) {
    // Set minimum date to today
    const today = new Date();
    this.minDate = today.toISOString().split('T')[0];
    // Set default delivery date to today
    this.deliveryDate = this.minDate;
  }

  ngOnInit(): void {
    this.inventoryService.getProducts().subscribe(products => {
      this.products = products.filter(p => p.quantity > 0);
    });

    this.customerService.getCustomers().subscribe(customers => {
      this.customers = customers;
    });

    this.inventoryService.getSales().subscribe(sales => {
      this.pendingSales = sales.filter(s => s.pending === true);
      this.startAlarmChecks();
    });
  }

  private startAlarmChecks(): void {
    // Check every hour
    setInterval(() => this.checkPendingDeliveryAlarms(), 60 * 60 * 1000);
    // Also run immediately
    this.checkPendingDeliveryAlarms();
  }

  private checkPendingDeliveryAlarms(): void {
    const now = new Date();
    this.pendingSales.forEach(sale => {
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
    day: 'numeric'
  });
  const message = `⚠️ Delivery for "${sale.productName}" is due in ${daysAhead} day(s) (${dateStr}).`;
  // Visual alert
  confirm(message);
  // Loud beep
  this.playBeep();
}

  private playBeep(): void {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
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
    return this.products.find(p => p.id === this.selectedProductId);
  }

  get selectedCustomer(): Customer | undefined {
    return this.customers.find(c => c.id === this.selectedCustomerId);
  }

  get total(): number {
    return this.selectedProduct ? this.selectedProduct.price * this.quantity : 0;
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
          deliveryDateObj = new Date(`${this.deliveryDate}T${this.deliveryTime}`);
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
        this.selectedCustomerId || undefined
      );

      // Reset form
      this.selectedProductId = '';
      this.quantity = 1;
      this.cashReceived = 0;
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
}
