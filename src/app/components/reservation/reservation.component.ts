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

  loadProducts() {
    this.inventoryService.getProducts().subscribe((products) => {
      this.products = products.filter((p) => p.quantity > 0); // Only show in-stock
    });
  }

  addToOrder() {
    if (!this.selectedProduct) return;

    const existing = this.orderItems.find(
      (i) => i.product.id === this.selectedProduct?.id
    );
    if (existing) {
      existing.quantity += this.selectedQuantity;
    } else {
      this.orderItems.push({
        product: this.selectedProduct,
        quantity: this.selectedQuantity,
      });
    }

    // Reset selection
    this.selectedProduct = null;
    this.selectedQuantity = 1;
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
      const fullNotes = `Address: ${this.customerAddress}\n\n${this.notes}`;

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
    this.notes = '';
    this.selectedProduct = null;
    this.pickupTime = '';
    // Keep pickup date
  }
}
