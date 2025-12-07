import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { ReservationService } from '../../services/reservation.service';
import { Product } from '../../models/inventory.models';

interface OrderItem {
  product: Product;
  quantity: number;
}

@Component({
  selector: 'app-reservation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reservation.component.html',
  styleUrl: './reservation.component.css',
})
export class ReservationComponent implements OnInit {
  products: Product[] = [];

  customerName = '';
  customerContact = '';
  customerAddress = '';
  notes = '';
  paymentOption = '';
  paymentOptions = ['Cash on Delivery', 'Gcash', 'Bank Transfer'];
  pickupDate: string = ''; // YYYY-MM-DD
  pickupTime: string = '';

  orderItems: OrderItem[] = [];
  selectedProduct: Product | null = null;
  selectedQuantity: number = 1;

  isSubmitting = false;
  successMessage = '';

  constructor(
    private inventoryService: InventoryService,
    private reservationService: ReservationService
  ) {}

  ngOnInit(): void {
    // Set default pickup date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.pickupDate = tomorrow.toISOString().split('T')[0];

    this.loadProducts();
  }

  tempQuantities: { [id: string]: number } = {};

  loadProducts() {
    this.inventoryService.getProducts().subscribe((products) => {
      this.products = products.filter((p) => p.quantity > 0); // Only show in-stock
    });
  }

  getQty(product: Product): number {
    return this.tempQuantities[product.id] || 1;
  }

  incrementQty(product: Product): void {
    const current = this.getQty(product);
    if (current < product.quantity) {
      this.tempQuantities[product.id] = current + 1;
    }
  }

  decrementQty(product: Product): void {
    const current = this.getQty(product);
    if (current > 1) {
      this.tempQuantities[product.id] = current - 1;
    }
  }

  manualQty(product: Product, event: any): void {
    const val = parseInt(event.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= product.quantity) {
      this.tempQuantities[product.id] = val;
    }
  }

  addToOrder(product: Product): void {
    const quantity = this.getQty(product);

    const existing = this.orderItems.find((i) => i.product.id === product.id);

    // Check total quantity including cart
    const currentInCart = existing ? existing.quantity : 0;

    if (currentInCart + quantity > product.quantity) {
      alert(
        `Cannot add more. You already have ${currentInCart} in cart. Max stock is ${product.quantity}.`
      );
      return;
    }

    if (existing) {
      existing.quantity += quantity;
    } else {
      this.orderItems.push({
        product: product,
        quantity: quantity,
      });
    }

    // Reset selection
    this.tempQuantities[product.id] = 1;
  }

  removeFromOrder(index: number) {
    this.orderItems.splice(index, 1);
  }

  get totalAmount(): number {
    return this.orderItems.reduce(
      (sum, item) => sum + item.product.price * item.quantity,
      0
    );
  }

  async submitReservation() {
    if (
      this.orderItems.length === 0 ||
      !this.customerName ||
      !this.customerContact ||
      !this.pickupDate ||
      !this.customerAddress
    ) {
      alert(
        'Please fill in all required fields and add items to your reservation.'
      );
      return;
    }

    this.isSubmitting = true;

    try {
      const fullDate = new Date(
        this.pickupDate +
          (this.pickupTime ? 'T' + this.pickupTime : 'T00:00:00')
      );
      const fullNotes = `Payment: ${
        this.paymentOption || 'Not Specified'
      }\nAddress: ${this.customerAddress}\n\n${this.notes}`;

      await this.reservationService.addReservation({
        customerName: this.customerName,
        customerContact: this.customerContact,
        reservationDate: new Date(),
        pickupDate: fullDate,
        status: 'pending',
        items: this.orderItems.map((i) => ({
          productId: i.product.id,
          productName: i.product.name,
          quantity: i.quantity,
          price: i.product.price,
        })),
        totalAmount: this.totalAmount,
        notes: fullNotes,
      });

      this.successMessage =
        'Reservation submitted successfully! We will contact you shortly.';
      this.resetForm();
    } catch (e) {
      console.error('Error submitting reservation', e);
      alert('Failed to submit reservation. Please try again.');
    } finally {
      this.isSubmitting = false;
    }
  }

  resetForm() {
    this.orderItems = [];
    this.customerName = '';
    this.customerContact = '';
    this.customerAddress = '';
    this.paymentOption = '';
    this.notes = '';
    this.selectedProduct = null;
    this.pickupTime = '';
    // Keep pickup date
  }
}
