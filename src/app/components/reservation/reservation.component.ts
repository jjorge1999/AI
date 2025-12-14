import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  HostListener,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { ReservationService } from '../../services/reservation.service';
import { CustomerService } from '../../services/customer.service';
import { DialogService } from '../../services/dialog.service';
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
  searchQuery = '';
  paymentOptions = ['Cash on Delivery', 'Gcash', 'Bank Transfer'];
  pickupDate: string = ''; // YYYY-MM-DD
  pickupTime: string = '';

  orderItems: OrderItem[] = [];
  selectedProduct: Product | null = null;
  selectedQuantity: number = 1;

  isSubmitting = false;
  successMessage = '';

  // Scroll-based sticky handling
  isSummarySticky = false;
  private scrollContainer: HTMLElement | null = null;

  constructor(
    private inventoryService: InventoryService,
    private reservationService: ReservationService,
    private customerService: CustomerService,
    private dialogService: DialogService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Set default pickup date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.pickupDate = tomorrow.toISOString().split('T')[0];
    this.pickupTime = '10:00';

    // Autofill customer info from localStorage (from chat session)
    const savedInfo = localStorage.getItem('chatCustomerInfo');
    if (savedInfo) {
      try {
        const info = JSON.parse(savedInfo);
        console.log('Reservation autofill from chatCustomerInfo:', info);
        this.customerName = info.name || '';
        // Check both possible phone field names
        this.customerContact =
          info.phoneNumber || info.phone || info.contact || '';
        // Check both possible address field names (Customer model uses deliveryAddress)
        this.customerAddress = info.deliveryAddress || info.address || '';
      } catch (e) {
        console.error('Error parsing chatCustomerInfo', e);
      }
    }

    this.generateCalendar();
    this.loadProducts();

    // Setup scroll listener on public-container
    setTimeout(() => this.setupScrollListener(), 100);
  }

  private setupScrollListener(): void {
    this.scrollContainer = document.querySelector('.public-container');
    if (this.scrollContainer) {
      this.scrollContainer.addEventListener('scroll', this.onScroll.bind(this));
    }
  }

  private onScroll(): void {
    if (this.scrollContainer) {
      // When scrolled past 80px, make summary sticky
      this.isSummarySticky = this.scrollContainer.scrollTop > 80;
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    // Remove scroll listener
    if (this.scrollContainer) {
      this.scrollContainer.removeEventListener(
        'scroll',
        this.onScroll.bind(this)
      );
    }
  }

  openChat(): void {
    // Dispatch custom event to open chat bubble in app component
    window.dispatchEvent(new CustomEvent('openChatBubble'));
  }

  loadProducts() {
    this.inventoryService.loadProducts();
    this.subscriptions.add(
      this.inventoryService.getProducts().subscribe((products) => {
        this.products = products.filter((p) => p.quantity > 0);
      })
    );
  }

  get filteredProducts(): Product[] {
    let result = this.products;
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      result = this.products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.category && p.category.toLowerCase().includes(q))
      );
    }
    return result;
  }

  // Step completion checks
  get isStep1Complete(): boolean {
    return this.orderItems.length > 0;
  }

  get isStep2Complete(): boolean {
    return !!(this.pickupDate && this.pickupTime && this.customerAddress);
  }

  get isStep3Complete(): boolean {
    return !!(this.customerName && this.customerContact);
  }

  get currentStep(): number {
    if (!this.isStep1Complete) return 1;
    if (!this.isStep2Complete) return 2;
    if (!this.isStep3Complete) return 3;
    return 3; // All complete
  }

  get progressPercentage(): number {
    let completed = 0;
    if (this.isStep1Complete) completed++;
    if (this.isStep2Complete) completed++;
    if (this.isStep3Complete) completed++;
    return Math.round((completed / 3) * 100);
  }

  getCartQty(product: Product): number {
    const item = this.orderItems.find((i) => i.product.id === product.id);
    return item ? item.quantity : 0;
  }

  increaseCart(product: Product) {
    const item = this.orderItems.find((i) => i.product.id === product.id);
    if (item) {
      if (item.quantity < product.quantity) {
        item.quantity++;
      }
    } else {
      this.orderItems.push({ product, quantity: 1 });
    }
  }

  decreaseCart(product: Product) {
    const index = this.orderItems.findIndex((i) => i.product.id === product.id);
    if (index > -1) {
      if (this.orderItems[index].quantity > 1) {
        this.orderItems[index].quantity--;
      } else {
        this.orderItems.splice(index, 1);
      }
    }
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
      this.dialogService.warning(
        'Geolocation is not supported by your browser',
        'Location Error'
      );
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
      this.dialogService.error(
        'Unable to retrieve your location',
        'Location Error'
      );
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
      this.dialogService.warning(
        'Please fill in all required fields and add items to your reservation.',
        'Missing Information'
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

        await firstValueFrom(
          this.customerService.addCustomer({
            name: this.customerName,
            phoneNumber: this.customerContact,
            deliveryAddress: this.customerAddress,
            gpsCoordinates: this.gpsCoordinates,
            ...(targetUserId ? { userId: targetUserId } : {}),
          })
        );
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

      // 4. Store pending reservation info for chat auto-message
      const pendingReservation = {
        customerName: this.customerName,
        deliveryDate: `${this.pickupDate} ${this.pickupTime}`,
        deliveryAddress: this.customerAddress,
        items: this.orderItems.map((i) => ({
          name: i.product.name,
          quantity: i.quantity,
          price: i.product.price,
        })),
        totalAmount: this.totalAmount,
        paymentMethod: this.paymentOption || 'Not Specified',
      };
      localStorage.setItem(
        'pendingReservationForChat',
        JSON.stringify(pendingReservation)
      );

      this.dialogService
        .success(
          'Reservation submitted successfully! We will contact you shortly. You can now chat with us!',
          'Reservation Confirmed'
        )
        .subscribe(() => {
          this.resetForm();
        });
    } catch (e) {
      console.error('Error submitting reservation', e);
      this.dialogService.error(
        'Failed to submit reservation. Please try again.',
        'Reservation Failed'
      );
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

  // Calendar Logic
  calendarDate: Date = new Date();
  calendarDays: {
    day: number;
    date: Date;
    isCurrentMonth: boolean;
    isSelected: boolean;
  }[] = [];

  generateCalendar() {
    const year = this.calendarDate.getFullYear();
    const month = this.calendarDate.getMonth();

    // First day of shadow month
    const firstDay = new Date(year, month, 1);
    const startDay = new Date(firstDay);
    startDay.setDate(firstDay.getDate() - firstDay.getDay()); // Start on Sunday

    this.calendarDays = [];
    const selected = this.pickupDate ? new Date(this.pickupDate) : null;
    // Reset time for comparison
    if (selected) selected.setHours(0, 0, 0, 0);

    for (let i = 0; i < 42; i++) {
      // 6 weeks
      const date = new Date(startDay);
      date.setDate(startDay.getDate() + i);

      // Check selection
      let isSelected = false;
      if (selected) {
        isSelected =
          date.getFullYear() === selected.getFullYear() &&
          date.getMonth() === selected.getMonth() &&
          date.getDate() === selected.getDate();
      }

      this.calendarDays.push({
        day: date.getDate(),
        date: date,
        isCurrentMonth: date.getMonth() === month,
        isSelected: isSelected,
      });
    }
  }

  changeMonth(offset: number) {
    this.calendarDate.setMonth(this.calendarDate.getMonth() + offset);
    this.generateCalendar();
  }

  onDateChange() {
    if (this.pickupDate) {
      this.calendarDate = new Date(this.pickupDate);
      this.generateCalendar();
    }
  }
}
