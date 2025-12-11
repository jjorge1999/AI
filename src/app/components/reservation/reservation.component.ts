import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { ReservationService } from '../../services/reservation.service';
import { CustomerService } from '../../services/customer.service';
import { Product } from '../../models/inventory.models';
import { Subscription, firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

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
export class ReservationComponent implements OnInit, OnDestroy {
  products: Product[] = [];
  private subscriptions: Subscription = new Subscription();

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
    private reservationService: ReservationService,
    private customerService: CustomerService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Set default pickup date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.pickupDate = tomorrow.toISOString().split('T')[0];

    // Autofill customer info from localStorage (from chat session)
    const savedInfo = localStorage.getItem('chatCustomerInfo');
    if (savedInfo) {
      try {
        const info = JSON.parse(savedInfo);
        this.customerName = info.name || '';
        this.customerContact = info.phoneNumber || '';
        this.customerAddress = info.address || info.deliveryAddress || '';
      } catch (e) {
        console.error('Error parsing chatCustomerInfo', e);
      }
    }

    this.loadProducts();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  tempQuantities: { [id: string]: number } = {};

  loadProducts() {
    // Trigger fetch (needed for guests since auto-fetch is disabled)
    this.inventoryService.loadProducts();

    this.subscriptions.add(
      this.inventoryService.getProducts().subscribe((products) => {
        this.products = products.filter((p) => p.quantity > 0); // Only show in-stock
      })
    );
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

  get subTotal(): number {
    return this.totalAmount / 1.12; // Net of Tax (assuming 12% VAT inclusive)
  }

  get taxAmount(): number {
    return this.totalAmount - this.subTotal;
  }

  gpsCoordinates = '';
  isLocationLoading = false;

  async getLocation() {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }

    this.isLocationLoading = true;

    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject);
        }
      );

      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      this.gpsCoordinates = `${lat},${lon}`;

      // Reverse Geocode to get address
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
        );
        const data = await response.json();
        if (data && data.display_name) {
          this.customerAddress = data.display_name;
        }
      } catch (geoError) {
        console.warn('Reverse geocoding failed', geoError);
      }
    } catch (error) {
      console.error('Error getting location', error);
      alert('Unable to retrieve your location');
    } finally {
      this.isLocationLoading = false;
    }
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
      const fullNotes = `Payment: ${this.paymentOption || 'Not Specified'}\n\n${
        this.notes
      }`;

      // 1. Check if customer already exists by phone number
      const customers = await firstValueFrom(
        this.customerService.getCustomers().pipe(take(1))
      );

      const existingCustomer = customers.find(
        (c) => c.phoneNumber === this.customerContact
      );

      // Only create customer if they don't exist
      if (!existingCustomer) {
        const targetUserId = this.orderItems[0]?.product?.userId;

        this.customerService
          .addCustomer({
            name: this.customerName,
            phoneNumber: this.customerContact,
            deliveryAddress: this.customerAddress,
            gpsCoordinates: this.gpsCoordinates,
            ...(targetUserId ? { userId: targetUserId } : {}),
          })
          .subscribe();
      }

      // 2. Submit reservation
      await firstValueFrom(
        this.reservationService.addReservation({
          customerName: this.customerName,
          customerContact: this.customerContact,
          customerAddress: this.customerAddress,
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
        })
      );

      // 3. Auto-login to chat by storing customer info (no expiration)
      const chatCustomerInfo = {
        name: this.customerName,
        phoneNumber: this.customerContact,
        address: this.customerAddress,
        gpsCoordinates: this.gpsCoordinates,
      };
      localStorage.setItem(
        'chatCustomerInfo',
        JSON.stringify(chatCustomerInfo)
      );
      localStorage.setItem('chatUserName', this.customerName);

      this.successMessage =
        'Reservation submitted successfully! We will contact you shortly. You can now chat with us!';
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

  makeNewReservation(): void {
    this.successMessage = '';
    this.resetForm();
  }

  goBack(): void {
    this.router.navigate(['/']);
    // Also clear hash if present
    if (window.location.hash.includes('reservation')) {
      history.pushState(
        '',
        document.title,
        window.location.pathname + window.location.search
      );
    }
  }
}
