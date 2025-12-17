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
import { SaleService } from '../../services/sale.service';
import { Product } from '../../models/inventory.models';
import { SaleEvent } from '../../models/sale.model';
import { Subscription, firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { AdsSliderComponent } from '../ads-slider/ads-slider.component';

interface OrderItem {
  product: Product;
  quantity: number;
}

@Component({
  selector: 'app-reservation',
  standalone: true,
  imports: [CommonModule, FormsModule, AdsSliderComponent],
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
  selectedCategory = 'All'; // Category filter
  paymentOptions = ['Cash on Delivery', 'Gcash', 'Bank Transfer'];
  pickupDate: string = ''; // YYYY-MM-DD
  pickupTime: string = '';

  // Special Events Calendar for automatic sales
  // Current active sale (loaded from Firestore)
  currentSale: {
    name: string;
    discount: number;
    endsIn: number;
    endDate: Date;
    bannerTitle?: string;
    bannerMessage?: string;
    bannerIcon?: string;
    holidayKeywords?: string[];
    excludeKeywords?: string[];
    saleType?: 'actual' | 'psychological';
    isActualSale?: boolean;
    actualDiscount?: number;
    isPsychologicalSale?: boolean;
    psychologicalDiscount?: number;
  } | null = null;
  countdown = { days: 0, hours: 0, minutes: 0, seconds: 0 };
  private countdownInterval: any = null;

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
    private saleService: SaleService,
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

    // Start listening to sales from Firestore and check for active sales
    this.saleService.startListening();
    this.subscriptions.add(
      this.saleService.getSales().subscribe((sales) => {
        if (sales.length > 0) {
          this.checkCurrentSale();
        }
      })
    );

    // Setup scroll listener on public-container
    setTimeout(() => this.setupScrollListener(), 100);

    // Initialize social proof section
    this.initializeSocialProof();
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
    // Clear countdown interval
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    // Clear social proof interval
    if (this.activityInterval) {
      clearInterval(this.activityInterval);
    }
    // Stop listening to Firestore sales
    this.saleService.stopListening();
  }

  openChat(): void {
    // Dispatch custom event to open chat bubble in app component
    window.dispatchEvent(new CustomEvent('openChatBubble'));
  }

  loadProducts() {
    // Load only products from admin-1 for the reservation page
    this.inventoryService.loadProductsForUser('admin-1');
    this.subscriptions.add(
      this.inventoryService.getProducts().subscribe((products) => {
        this.products = products.filter((p) => p.quantity > 0);
      })
    );
  }

  /**
   * Check if there's an active special event sale (from Firestore)
   */
  private checkCurrentSale(): void {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const sales = this.saleService['salesSubject'].value;

    for (const sale of sales) {
      if (!sale.isActive) continue;

      const eventStart = new Date(now.getFullYear(), sale.month - 1, sale.day);
      const eventEnd = new Date(eventStart);
      eventEnd.setDate(eventEnd.getDate() + sale.duration);
      eventEnd.setHours(23, 59, 59, 999);

      // Handle year wrap-around
      if (sale.month === 12 && currentMonth === 1) {
        eventStart.setFullYear(now.getFullYear() - 1);
        eventEnd.setFullYear(now.getFullYear());
      }

      if (now >= eventStart && now <= eventEnd) {
        const daysRemaining = Math.ceil(
          (eventEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        this.currentSale = {
          name: sale.name,
          discount: sale.discount,
          endsIn: daysRemaining,
          endDate: eventEnd,
          bannerTitle: sale.bannerTitle,
          bannerMessage: sale.bannerMessage,
          bannerIcon: sale.bannerIcon,
          holidayKeywords: sale.holidayKeywords,
          excludeKeywords: sale.excludeKeywords,
          saleType: sale.saleType,
          isActualSale: sale.isActualSale,
          actualDiscount: sale.actualDiscount,
          isPsychologicalSale: sale.isPsychologicalSale,
          psychologicalDiscount: sale.psychologicalDiscount,
        };
        this.startCountdown();
        return;
      }
    }
    this.currentSale = null;
  }

  /**
   * Start the countdown timer
   */
  private startCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    this.updateCountdown();
    this.countdownInterval = setInterval(() => this.updateCountdown(), 1000);
  }

  /**
   * Update countdown values
   */
  private updateCountdown(): void {
    if (!this.currentSale) return;

    const now = new Date().getTime();
    const end = this.currentSale.endDate.getTime();
    const diff = end - now;

    if (diff <= 0) {
      this.countdown = { days: 0, hours: 0, minutes: 0, seconds: 0 };
      this.currentSale = null;
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
      }
      return;
    }

    this.countdown = {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
      minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
      seconds: Math.floor((diff % (1000 * 60)) / 1000),
    };
  }

  /**
   * Generate a pseudo-random but consistent discount for a product
   * Uses product ID hash to create consistent randomization
   */
  private getProductSeed(productId: string): number {
    let hash = 0;
    for (let i = 0; i < productId.length; i++) {
      hash = (hash << 5) - hash + productId.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  // Default keywords (fallback if sale doesn't specify)
  private defaultHolidayKeywords = [
    'lechon',
    'food',
    'party',
    'cake',
    'drink',
    'beverage',
    'wine',
    'ham',
    'fruit',
    'meat',
    'chicken',
    'pork',
    'beef',
    'seafood',
    'fish',
    'dessert',
    'candy',
    'chocolate',
    'gift',
    'decoration',
    'light',
    'ornament',
    'toy',
    'clothing',
    'dress',
    'shirt',
    'shoes',
    'bag',
    'watch',
    'jewelry',
    'electronics',
    'phone',
    'laptop',
    'tablet',
    'appliance',
    'kitchen',
  ];

  private defaultExcludeKeywords = [
    'sand',
    'gravel',
    'cement',
    'holloblock',
    'hollow',
    'block',
    'steel',
    'rebar',
    'wire',
    'nail',
    'lumber',
    'wood',
    'plywood',
    'paint',
    'tile',
    'pipe',
    'pvc',
    'fitting',
    'construction',
    'building',
    'hardware',
  ];

  /**
   * Check if a product is holiday-related (eligible for sale)
   * Uses keywords from currentSale if available, otherwise defaults
   */
  isHolidayItem(product: Product): boolean {
    const name = product.name.toLowerCase();
    const category = (product.category || '').toLowerCase();

    // Get keywords from current sale or use defaults
    const excludeKeywords =
      this.currentSale?.excludeKeywords || this.defaultExcludeKeywords;
    const holidayKeywords =
      this.currentSale?.holidayKeywords || this.defaultHolidayKeywords;

    // Check if it's explicitly excluded
    for (const keyword of excludeKeywords) {
      if (name.includes(keyword) || category.includes(keyword)) {
        return false;
      }
    }

    // Check if it matches holiday keywords
    for (const keyword of holidayKeywords) {
      if (name.includes(keyword) || category.includes(keyword)) {
        return true;
      }
    }

    // Default: items not in construction/hardware categories are on sale
    return !['construction', 'hardware', 'building', 'industrial'].includes(
      category
    );
  }

  /**
   * Check if a specific product should show as on sale
   */
  isProductOnSale(product: Product): boolean {
    return this.isSaleActive && this.isHolidayItem(product);
  }

  /**
   * Get randomized discount percentage for a specific product
   * Varies from base discount ± 15% for variety
   * ADJUSTED based on stock level ("actual sold" proxy):
   * - High stock (>20): +Discount (Clearance)
   * - Low stock (<5): -Discount (Scarcity)
   */
  calculateDynamicDiscount(product: Product, baseDiscount: number): number {
    const seed = this.getProductSeed(product.id);
    const baseVariation = (seed % 25) - 15;

    let stockAdjustment = 0;
    if (product.quantity > 20) stockAdjustment = 5 + (seed % 6);
    else if (product.quantity < 5) stockAdjustment = -5 - (seed % 6);

    const adjusted = Math.min(
      95,
      Math.max(15, baseDiscount + baseVariation + stockAdjustment)
    );
    return Math.round(adjusted / 5) * 5;
  }

  getProductDiscount(product: Product): number {
    if (!this.currentSale || !this.isHolidayItem(product)) return 0;

    const final = this.getFinalPrice(product);
    const original = this.getOriginalPrice(product);

    if (original <= final) return 0;
    return Math.round(((original - final) / original) * 100);
  }

  getOriginalPrice(product: Product): number {
    if (!this.currentSale || !this.isHolidayItem(product)) return product.price;

    const isActual = this.currentSale.isActualSale;
    const isPsych = this.currentSale.isPsychologicalSale;
    const actDisc = this.currentSale.actualDiscount || 0;
    const psyDisc = this.currentSale.psychologicalDiscount || 0;

    // Fallback for legacy
    if (isActual === undefined && isPsych === undefined) {
      const type = this.currentSale.saleType || 'psychological';
      if (type === 'actual') return product.price;
      // Psych fallback (using legacy 'discount' property? Accessing via 'this.currentSale.discount' might be tricky if type def says it's missing on SaleEvent?)
      // Actually SaleEvent helper/interface usually has 'discount'.
      // But in Step 1076 I removed it? No, I KEPT it.
      // 'discount' logic in older code used 'this.currentSale.discount'.
      // I'll grab it safely.
      const fallbackDisc = (this.currentSale as any).discount || 30;
      const disc = this.calculateDynamicDiscount(product, fallbackDisc);
      return Math.ceil(product.price / (1 - disc / 100) / 10) * 10;
    }

    if (isPsych) {
      // Inflate from the Final Price (so badge matches input)
      const finalPrice = this.getFinalPrice(product);
      const dynamicPsyDisc = this.calculateDynamicDiscount(product, psyDisc);
      const multiplier = 1 - dynamicPsyDisc / 100;
      const inflated = finalPrice / multiplier;
      return Math.ceil(inflated / 10) * 10;
    }

    return product.price;
  }

  getFinalPrice(product: Product): number {
    if (!this.currentSale || !this.isHolidayItem(product)) return product.price;

    const isActual = this.currentSale.isActualSale;
    const actDisc = this.currentSale.actualDiscount || 0;

    // Fallback
    if (isActual === undefined) {
      if (this.currentSale.saleType === 'actual') {
        const fallbackDisc = (this.currentSale as any).discount || 30;
        const disc = this.calculateDynamicDiscount(product, fallbackDisc);
        return product.price * (1 - disc / 100);
      }
      return product.price;
    }

    if (isActual) {
      const dynamicActDisc = this.calculateDynamicDiscount(product, actDisc);
      return product.price * (1 - dynamicActDisc / 100);
    }

    return product.price;
  }

  /**
   * Check if sale is active
   */
  get isSaleActive(): boolean {
    return this.currentSale !== null;
  }

  // Banner Interactivity
  scrollToFeaturedDeals() {
    // Small delay to ensure view is ready if toggled
    setTimeout(() => {
      const element = document.getElementById('featured-deals');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }

  get urgencyLevel(): 'normal' | 'warning' | 'critical' {
    if (this.countdown.days >= 3) return 'normal';
    if (this.countdown.days >= 1) return 'warning';
    return 'critical'; // < 24 hours
  }

  get urgencyText(): string {
    switch (this.urgencyLevel) {
      case 'critical':
        return 'HURRY! ENDING SOON';
      case 'warning':
        return 'Time is Running Out';
      default:
        return 'Ends in';
    }
  }

  // Get unique categories from products
  get categories(): string[] {
    const cats = new Set(this.products.map((p) => p.category || 'Other'));
    return ['All', ...Array.from(cats).sort()];
  }

  get filteredProducts(): Product[] {
    let result = this.products;

    // Filter by category
    if (this.selectedCategory && this.selectedCategory !== 'All') {
      result = result.filter((p) => p.category === this.selectedCategory);
    }

    // Filter by search query
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.category && p.category.toLowerCase().includes(q))
      );
    }
    return result;
  }

  // Low stock detection (subtle urgency without revealing exact numbers)
  isLowStock(product: Product): boolean {
    return product.quantity > 0 && product.quantity <= 10;
  }

  isVeryLowStock(product: Product): boolean {
    return product.quantity > 0 && product.quantity <= 3;
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
      (sum, item) => sum + this.getFinalPrice(item.product) * item.quantity,
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
            price: this.getFinalPrice(i.product),
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
          price: this.getFinalPrice(i.product),
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

  // Sale Table Pagination and Sorting
  salePage = 1;
  salePageSize = 5;
  saleSortBy: 'discount' | 'price-low' | 'price-high' | 'stock' | 'name' =
    'discount';

  get discountedProducts(): Product[] {
    const filtered = this.products.filter((p) => this.isProductOnSale(p));
    return this.sortSaleProducts(filtered);
  }

  private sortSaleProducts(products: Product[]): Product[] {
    const sorted = [...products];

    switch (this.saleSortBy) {
      case 'discount':
        // Sort by highest discount first
        return sorted.sort(
          (a, b) => this.getProductDiscount(b) - this.getProductDiscount(a)
        );

      case 'price-low':
        // Sort by lowest price first
        return sorted.sort(
          (a, b) => this.getFinalPrice(a) - this.getFinalPrice(b)
        );

      case 'price-high':
        // Sort by highest price first
        return sorted.sort(
          (a, b) => this.getFinalPrice(b) - this.getFinalPrice(a)
        );

      case 'stock':
        // Sort by stock level (low stock first for urgency)
        return sorted.sort((a, b) => a.quantity - b.quantity);

      case 'name':
        // Sort alphabetically A-Z
        return sorted.sort((a, b) => a.name.localeCompare(b.name));

      default:
        return sorted;
    }
  }

  setSaleSortBy(
    sortBy: 'discount' | 'price-low' | 'price-high' | 'stock' | 'name'
  ) {
    this.saleSortBy = sortBy;
    this.salePage = 1; // Reset to first page when sorting changes
  }

  get paginatedSaleProducts(): Product[] {
    const start = (this.salePage - 1) * this.salePageSize;
    return this.discountedProducts.slice(start, start + this.salePageSize);
  }

  get saleTotalPages(): number {
    return Math.ceil(this.discountedProducts.length / this.salePageSize);
  }

  nextSalePage() {
    if (this.salePage < this.saleTotalPages) this.salePage++;
  }

  prevSalePage() {
    if (this.salePage > 1) this.salePage--;
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

  // ===== Social Proof Section =====

  // Simulated activity data for social proof (encourages buyers)
  recentActivities: {
    name: string;
    initials: string;
    action: string;
    time: string;
    isNew: boolean;
  }[] = [];
  busyDates: {
    label: string;
    count: number;
    level: 'high' | 'medium' | 'low';
  }[] = [];

  private activityInterval: any = null;
  private readonly firstNames = [
    'Maria',
    'Juan',
    'Ana',
    'Jose',
    'Rosa',
    'Pedro',
    'Elena',
    'Carlos',
    'Sofia',
    'Miguel',
    'Isabella',
    'Antonio',
    'Lucia',
    'Marco',
    'Carmen',
  ];
  private readonly actions = [
    'reserved delivery for',
    'just ordered',
    'placed a reservation for',
    'booked delivery on',
    'scheduled pickup for',
  ];

  get recentReservationsToday(): number {
    // Generate a consistent number based on the current hour
    const hour = new Date().getHours();
    const base = 12 + Math.floor(hour / 2);
    return base + (this.getDateSeed() % 8);
  }

  get recentReservationsWeek(): number {
    // Generate a consistent number for the week
    const dayOfWeek = new Date().getDay();
    return 45 + dayOfWeek * 8 + (this.getDateSeed() % 15);
  }

  get busyDatesCount(): number {
    return this.busyDates.length;
  }

  private getDateSeed(): number {
    const now = new Date();
    return now.getDate() + now.getMonth() * 31;
  }

  private initializeSocialProof(): void {
    this.generateBusyDates();
    this.generateRecentActivities();

    // Update activities periodically
    this.activityInterval = setInterval(() => {
      this.addNewActivity();
    }, 15000); // Add new activity every 15 seconds
  }

  private generateBusyDates(): void {
    const today = new Date();
    this.busyDates = [];

    // Generate 3-5 busy dates in the next 2 weeks
    const numDates = 3 + (this.getDateSeed() % 3);
    const usedDays = new Set<number>();

    for (let i = 0; i < numDates; i++) {
      let daysAhead = 1 + ((this.getDateSeed() * (i + 1)) % 14);
      while (usedDays.has(daysAhead)) {
        daysAhead = ((daysAhead + 1) % 14) + 1;
      }
      usedDays.add(daysAhead);

      const date = new Date(today);
      date.setDate(today.getDate() + daysAhead);

      const count = 5 + ((this.getDateSeed() + i * 7) % 12);
      let level: 'high' | 'medium' | 'low' = 'low';
      if (count >= 12) level = 'high';
      else if (count >= 8) level = 'medium';

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const monthNames = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];

      this.busyDates.push({
        label: `${dayNames[date.getDay()]}, ${
          monthNames[date.getMonth()]
        } ${date.getDate()}`,
        count,
        level,
      });
    }

    // Sort by date
    this.busyDates.sort((a, b) => a.count - b.count).reverse();
  }

  private generateRecentActivities(): void {
    this.recentActivities = [];
    const times = [
      'Just now',
      '2 min ago',
      '5 min ago',
      '12 min ago',
      '28 min ago',
    ];

    for (let i = 0; i < 4; i++) {
      const firstName =
        this.firstNames[(this.getDateSeed() + i * 3) % this.firstNames.length];
      const action =
        this.actions[(this.getDateSeed() + i) % this.actions.length];

      // Generate a date in the next 1-7 days
      const daysAhead = 1 + ((this.getDateSeed() + i) % 7);
      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + daysAhead);
      const monthNames = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];

      this.recentActivities.push({
        name: firstName,
        initials: firstName.substring(0, 2).toUpperCase(),
        action: `${action} ${
          monthNames[deliveryDate.getMonth()]
        } ${deliveryDate.getDate()}`,
        time: times[i],
        isNew: false,
      });
    }
  }

  private addNewActivity(): void {
    const firstName =
      this.firstNames[Math.floor(Math.random() * this.firstNames.length)];
    const action =
      this.actions[Math.floor(Math.random() * this.actions.length)];

    const daysAhead = 1 + Math.floor(Math.random() * 7);
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + daysAhead);
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    // Add new activity to the front
    this.recentActivities.unshift({
      name: firstName,
      initials: firstName.substring(0, 2).toUpperCase(),
      action: `${action} ${
        monthNames[deliveryDate.getMonth()]
      } ${deliveryDate.getDate()}`,
      time: 'Just now',
      isNew: true,
    });

    // Remove the oldest activity
    if (this.recentActivities.length > 4) {
      this.recentActivities.pop();
    }

    // Update times for existing activities
    setTimeout(() => {
      this.recentActivities.forEach((a, i) => {
        if (i === 0) a.isNew = false;
      });
    }, 500);
  }
}
