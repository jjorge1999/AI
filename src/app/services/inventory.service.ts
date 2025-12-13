import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Product, Sale, Expense } from '../models/inventory.models';
import { environment } from '../../environments/environment';
import { LoggingService } from './logging.service';
import { CustomerService } from './customer.service';
import { FirebaseService } from './firebase.service';
import { FirebaseApp } from 'firebase/app';
import {
  Firestore,
  collection,
  query,
  where,
  onSnapshot,
  Unsubscribe,
  Timestamp,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  orderBy,
  limit,
} from 'firebase/firestore';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  User,
} from 'firebase/auth';

@Injectable({
  providedIn: 'root',
})
export class InventoryService {
  private apiUrl = environment.apiUrl;

  private productsSubject = new BehaviorSubject<Product[]>([]);
  private salesSubject = new BehaviorSubject<Sale[]>([]);
  private expensesSubject = new BehaviorSubject<Expense[]>([]);

  public products$ = this.productsSubject.asObservable();
  public sales$ = this.salesSubject.asObservable();
  public expenses$ = this.expensesSubject.asObservable();

  private app: FirebaseApp;
  private db: Firestore;
  private auth;
  private firebaseUser: User | null = null;
  private unsubscribes: Unsubscribe[] = [];
  private pollingInterval: any = null;

  constructor(
    private http: HttpClient,
    private loggingService: LoggingService,
    private customerService: CustomerService,
    private firebaseService: FirebaseService
  ) {
    this.app = this.firebaseService.app;
    this.db = this.firebaseService.db;
    this.auth = getAuth(this.app);
    // Manual loading only (via AppComponent or specific components)
  }

  private getCurrentUser(): string {
    return localStorage.getItem('jjm_user_id') || 'guest';
  }

  private getFirestoreUserId(): string {
    if (this.firebaseUser) return this.firebaseUser.uid;

    // If we consciously disabled auth (Public Mode), this is expected.
    if (localStorage.getItem('firebase_auth_disabled') === 'true') {
      return this.getCurrentUser();
    }

    console.warn(
      'Firestore User ID requested but not authenticated. Using legacy fallback.'
    );
    return this.getCurrentUser();
  }

  public reloadData(): void {
    this.startRealtimeListeners();
  }

  public stopRealtimeListeners(): void {
    this.unsubscribes.forEach((unsub) => unsub());
    this.unsubscribes = [];
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private startRealtimeListeners(): void {
    this.stopRealtimeListeners(); // Cleanup first

    const legacyUserId = this.getCurrentUser();
    if (!legacyUserId || legacyUserId === 'guest') return;

    // 0. Check for cached failure to avoid console noise
    const isAuthDisabled =
      localStorage.getItem('firebase_auth_disabled') === 'true';
    if (isAuthDisabled) {
      console.log('Auth previously failed. Skipping to Public/Fallback Mode.');
      this.setupFirestoreListeners(legacyUserId, legacyUserId);
      return;
    }

    // 1. Check if we already have a user
    const currentUser = this.auth.currentUser;
    if (currentUser) {
      console.log('Already Authenticated. Starting Secure Listeners.');
      this.firebaseUser = currentUser;
      this.setupFirestoreListeners(currentUser.uid, legacyUserId);
      return;
    }

    // 2. Try to Sign In
    signInAnonymously(this.auth)
      .then((cred) => {
        console.log('Signed In Anonymously. Starting Secure Listeners.');
        this.firebaseUser = cred.user;
        this.setupFirestoreListeners(cred.user.uid, legacyUserId);
      })
      .catch((err) => {
        console.warn(
          'Anonymous Auth unavailable. Attempting Public Realtime Mode with Legacy ID.'
        );
        // Cache the failure so we don't spam 400 errors on reload
        localStorage.setItem('firebase_auth_disabled', 'true');

        // 3. Fallback to Public Mode (using Legacy ID as Firestore ID)
        this.setupFirestoreListeners(legacyUserId, legacyUserId);
      });
  }

  private setupFirestoreListeners(firestoreId: string, legacyId: string): void {
    console.log(
      `Starting Firestore Listeners. FirestoreID: ${firestoreId}, LegacyID: ${legacyId}`
    );

    // Products
    // For customers, fetch ALL products so the AI can respond to inquiries
    const isCustomer = !!localStorage.getItem('customer_id');
    let productsQuery;

    if (isCustomer) {
      console.log(
        'InventoryService: Customer Mode - Fetching ALL products for AI'
      );
      productsQuery = query(
        collection(this.db, 'products'),
        orderBy('name', 'asc'),
        limit(100)
      );
    } else {
      // Seller Mode: Query by userId
      productsQuery = query(
        collection(this.db, 'products'),
        where('userId', '==', legacyId)
      );
    }

    this.unsubscribes.push(
      onSnapshot(
        productsQuery,
        (snapshot) => {
          console.log('Products Snapshot:', snapshot.docs.length);
          const products = snapshot.docs.map(
            (doc) =>
              ({
                id: doc.id,
                ...(doc.data() as any),
              } as Product)
          );
          this.productsSubject.next(products);
          if (!isCustomer && products.length === 0) {
            this.migrateProducts(legacyId, firestoreId);
          }
        },
        (err) => {
          console.error('Products Listener Error:', err);
          if (err.code === 'permission-denied') {
            console.warn('Permission Denied. Falling back to Legacy Polling.');
            this.fallbackToLegacyPolling();
          }
        }
      )
    );

    // Sales
    // Determine if we are querying as a Seller or a Customer
    let salesQuery;
    // isCustomer already declared above

    if (isCustomer) {
      console.log(
        'InventoryService: Customer Mode - Querying RECENT sales for fuzzy matching'
      );
      // Fetch recent sales to find customer records even if unlinked (by Name)
      // Note: This relies on Client-Side filtering in ChatComponent.
      salesQuery = query(
        collection(this.db, 'sales'),
        orderBy('timestamp', 'desc'),
        limit(100)
      );
    } else {
      // Seller Mode: Query by userId
      salesQuery = query(
        collection(this.db, 'sales'),
        where('userId', '==', legacyId)
      );
    }

    this.unsubscribes.push(
      onSnapshot(
        salesQuery,
        (snapshot) => {
          console.log('Sales Snapshot:', snapshot.docs.length);
          const sales = snapshot.docs.map((doc) =>
            this.transformSale({ id: doc.id, ...doc.data() })
          );
          this.salesSubject.next(sales);
          // Only migrate if we are Admin/Seller and empty?
          if (!isCustomer && sales.length === 0) {
            this.migrateSales(legacyId, firestoreId);
          }
        },
        (err) => console.error('Sales Listener Error:', err)
      )
    );

    // Expenses
    const expensesQuery = query(
      collection(this.db, 'expenses'),
      where('userId', '==', firestoreId)
    );
    this.unsubscribes.push(
      onSnapshot(
        expensesQuery,
        (snapshot) => {
          console.log('Expenses Snapshot:', snapshot.docs.length);
          const expenses = snapshot.docs.map(
            (doc) =>
              ({
                id: doc.id,
                ...(doc.data() as any),
              } as Expense)
          );
          this.expensesSubject.next(expenses);
          if (expenses.length === 0) {
            this.migrateExpenses(legacyId, firestoreId);
          }
        },
        (err) => console.error('Expenses Listener Error:', err)
      )
    );
  }

  private fallbackToLegacyPolling(): void {
    if (this.pollingInterval) return; // Already polling
    console.log('Starting Legacy Polling (Fallback Mode)...');

    this.fetchAllLegacyData();
    this.pollingInterval = setInterval(
      () => this.fetchAllLegacyData(),
      10000 // Poll every 10 seconds
    );
  }

  private fetchAllLegacyData(): void {
    this.fetchProducts();
    this.fetchSales();
    this.fetchExpenses();
  }

  private migrateProducts(legacyId: string, firestoreId: string): void {
    this.http
      .get<Product[]>(`${this.apiUrl}/products?userId=${legacyId}`)
      .subscribe((products) => {
        products.forEach(async (p) => {
          try {
            await setDoc(doc(this.db, 'products', p.id), {
              ...p,
              userId: firestoreId,
            });
          } catch (e) {
            console.error('Error migrating product:', e);
          }
        });
      });
  }

  private migrateSales(legacyId: string, firestoreId: string): void {
    this.http
      .get<any[]>(`${this.apiUrl}/sales?userId=${legacyId}`)
      .subscribe((sales) => {
        sales.forEach(async (s) => {
          try {
            const data = {
              ...s,
              pending: s.pending === true || s.pending === 'true',
              timestamp: this.parseDate(s.timestamp),
              deliveryDate: s.deliveryDate
                ? this.parseDate(s.deliveryDate)
                : null,
              userId: firestoreId,
            };
            await setDoc(doc(this.db, 'sales', s.id), data);
          } catch (e) {
            console.error('Error migrating sale:', e);
          }
        });
      });
  }

  private migrateExpenses(legacyId: string, firestoreId: string): void {
    this.http
      .get<Expense[]>(`${this.apiUrl}/expenses?userId=${legacyId}`)
      .subscribe((expenses) => {
        expenses.forEach(async (e) => {
          try {
            const data = {
              ...e,
              timestamp: this.parseDate(e.timestamp),
              userId: firestoreId,
            };
            await setDoc(doc(this.db, 'expenses', e.id), data);
          } catch (err) {
            console.error('Error migrating expense:', err);
          }
        });
      });
  }

  public loadProducts(): void {
    this.fetchProducts();
  }

  private fetchProducts(): void {
    const userId = this.getCurrentUser();

    // Note: Guard removed to allow public access to products (for Reservation).
    // This is safe because it is not called automatically in constructor.

    let url = `${this.apiUrl}/products`;
    if (userId && userId !== 'guest') {
      url += `?userId=${userId}`;
    }

    this.http.get<Product[]>(url).subscribe({
      next: (products) => this.productsSubject.next(products),
      error: (err) => console.error('Error fetching products:', err),
    });
  }

  private fetchSales(): void {
    const userId = this.getCurrentUser();
    if (!userId || userId === 'guest') return;

    this.http.get<Sale[]>(`${this.apiUrl}/sales?userId=${userId}`).subscribe({
      next: (sales) => {
        const parsedSales = sales.map((sale) => this.transformSale(sale));
        this.salesSubject.next(parsedSales);
      },
      error: (err) => console.error('Error fetching sales:', err),
    });
  }

  private fetchExpenses(): void {
    const userId = this.getCurrentUser();
    if (!userId || userId === 'guest') return;

    this.http
      .get<Expense[]>(`${this.apiUrl}/expenses?userId=${userId}`)
      .subscribe({
        next: (expenses) => this.expensesSubject.next(expenses),
        error: (err) => console.error('Error fetching expenses:', err),
      });
  }

  getProducts(): Observable<Product[]> {
    return this.products$;
  }

  getSales(): Observable<Sale[]> {
    return this.sales$;
  }

  getExpenses(): Observable<Expense[]> {
    return this.expenses$;
  }

  async addExpense(expense: Omit<Expense, 'id' | 'timestamp'>): Promise<void> {
    const baseData = {
      ...expense,
      timestamp: new Date(),
    };

    // 1. Try Firestore (Best Effort)
    let firestoreId: string | undefined;
    try {
      const firestoreData = { ...baseData, userId: this.getFirestoreUserId() };
      const docRef = await addDoc(
        collection(this.db, 'expenses'),
        firestoreData
      );
      firestoreId = docRef.id;
    } catch (e) {
      console.warn('Firestore write failed (proceeding with Legacy):', e);
    }

    // 2. Legacy Backend (Direct)
    const legacyData = { ...baseData, userId: this.getCurrentUser() };
    if (firestoreId) {
      Object.assign(legacyData, { id: firestoreId });
    }

    this.http.post<Expense>(`${this.apiUrl}/expenses`, legacyData).subscribe({
      next: (newExpense) => {
        // Update subject if listener didn't catch it
        const current = this.expensesSubject.value;
        // Avoid dupe if listener caught it
        if (!current.find((e) => e.id === newExpense.id)) {
          this.expensesSubject.next([...current, newExpense]);
        }

        this.loggingService.logActivity(
          'create',
          'expense',
          newExpense.id,
          newExpense.productName,
          `$${newExpense.price.toFixed(2)}`
        );
      },
      error: (err) => console.error('Error adding expense:', err),
    });
  }

  async deleteExpense(expenseId: string): Promise<void> {
    // 1. Try Firestore (Best Effort)
    try {
      await deleteDoc(doc(this.db, 'expenses', expenseId));
    } catch (e) {
      console.warn('Firestore delete failed (proceeding with Legacy):', e);
    }

    // 2. Legacy Backend (Direct)
    this.http.delete(`${this.apiUrl}/expenses/${expenseId}`).subscribe({
      next: () => {
        // Update subject
        const current = this.expensesSubject.value;
        this.expensesSubject.next(current.filter((e) => e.id !== expenseId));

        this.loggingService.logActivity(
          'delete',
          'expense',
          expenseId,
          'Expense',
          'Deleted'
        );
      },
      error: (err) => console.error('Error deleting expense:', err),
    });
  }

  async addProduct(product: Omit<Product, 'id' | 'createdAt'>): Promise<void> {
    const baseData = {
      ...product,
      createdAt: new Date(),
    };

    let firestoreId: string | undefined;
    try {
      const firestoreData = { ...baseData, userId: this.getFirestoreUserId() };
      const docRef = await addDoc(
        collection(this.db, 'products'),
        firestoreData
      );
      firestoreId = docRef.id;
    } catch (e) {
      console.warn('Firestore write failed:', e);
    }

    const legacyData = { ...baseData, userId: this.getCurrentUser() };
    if (firestoreId) Object.assign(legacyData, { id: firestoreId });

    this.http.post<Product>(`${this.apiUrl}/products`, legacyData).subscribe({
      next: (newProduct) => {
        const current = this.productsSubject.value;
        if (!current.find((p) => p.id === newProduct.id)) {
          this.productsSubject.next([...current, newProduct]);
        }
        this.loggingService.logActivity(
          'create',
          'product',
          newProduct.id,
          newProduct.name
        );
      },
      error: (err) => console.error('Error adding product:', err),
    });
  }

  async deleteProduct(productId: string): Promise<void> {
    const products = this.productsSubject.value;
    const product = products.find((p) => p.id === productId);

    // 1. Try Firestore (Best Effort)
    try {
      await deleteDoc(doc(this.db, 'products', productId));
    } catch (e) {
      console.warn('Firestore delete failed (proceeding with Legacy):', e);
    }

    // 2. Legacy Backend (Direct)
    this.http.delete(`${this.apiUrl}/products/${productId}`).subscribe({
      next: () => {
        // Update subject
        const current = this.productsSubject.value;
        this.productsSubject.next(current.filter((p) => p.id !== productId));

        this.loggingService.logActivity(
          'delete',
          'product',
          productId,
          product?.name || 'Product',
          'Deleted'
        );
      },
      error: (err) => console.error('Error deleting product:', err),
    });
  }

  async recordSale(
    productId: string,
    quantitySold: number,
    cashReceived: number,
    deliveryDate?: Date,
    deliveryNotes?: string,
    customerId?: string,
    discount: number = 0,
    discountType: 'amount' | 'percent' = 'amount',
    orderId?: string
  ): Promise<void> {
    const products = this.productsSubject.value;
    const product = products.find((p) => p.id === productId);

    if (!product) {
      throw new Error('Product not found');
    }

    if (product.quantity < quantitySold) {
      throw new Error('Insufficient quantity');
    }

    let total = product.price * quantitySold;

    // Apply discount
    if (discount > 0) {
      if (discountType === 'percent') {
        total = total - total * (discount / 100);
      } else {
        total = total - discount;
      }
    }

    // Ensure total is not negative and round to 2 decimal places
    total = Math.max(0, Math.round(total * 100) / 100);

    const change = cashReceived - total;

    if (change < 0) {
      throw new Error('Insufficient cash');
    }

    const baseData = {
      productId: product.id,
      productName: product.name,
      category: product.category,
      price: product.price,
      quantitySold,
      total,
      cashReceived,
      change,
      deliveryDate,
      deliveryNotes,
      customerId,
      pending: true,
      discount,
      discountType,
      orderId,
      timestamp: new Date(),
    };

    // Firestore Dual Write (Best Effort)
    let firestoreId: string | undefined;
    try {
      const firestoreData = { ...baseData, userId: this.getFirestoreUserId() };
      const docRef = await addDoc(collection(this.db, 'sales'), firestoreData);
      firestoreId = docRef.id;
    } catch (e) {
      console.warn('Firestore Sale Write Failed:', e);
    }

    const legacyData = { ...baseData, userId: this.getCurrentUser() };
    if (firestoreId) Object.assign(legacyData, { id: firestoreId });

    this.http.post<Sale>(`${this.apiUrl}/sales`, legacyData).subscribe({
      next: (newSale) => {
        // Update local sales state
        const currentSales = this.salesSubject.value;
        if (!currentSales.find((s) => s.id === newSale.id)) {
          this.salesSubject.next([
            ...currentSales,
            this.transformSale(newSale),
          ]);
        }

        this.loggingService.logActivity(
          'create',
          'sale',
          newSale.id,
          product.name,
          `Sold ${quantitySold} units (Pending Delivery)`
        );
      },
      error: (err) => console.error('Error recording sale:', err),
    });
  }

  completePendingSale(saleId: string): void {
    // Determine sale details first to deduct stock
    const currentSales = this.salesSubject.value;
    const sale = currentSales.find((s) => s.id === saleId);

    if (!sale) {
      console.error('Sale not found via ID');
      return;
    }

    this.http
      .put<Sale>(`${this.apiUrl}/sales/${saleId}`, { pending: false })
      .subscribe({
        next: () => {
          const updatedSales = currentSales.map((s) =>
            s.id === saleId ? { ...s, pending: false } : s
          );
          this.salesSubject.next(updatedSales);

          // Deduct Inventory Now
          const products = this.productsSubject.value;
          const product = products.find((p) => p.id === sale.productId);
          if (product) {
            const updatedProduct = {
              ...product,
              quantity: product.quantity - sale.quantitySold,
            };
            this.updateProduct(updatedProduct);
          }

          // Award Credits to Customer
          if (sale.customerId) {
            const customer = this.customerService.getCustomerById(
              sale.customerId
            );
            if (customer) {
              const creditsEarned = Math.floor(sale.total / 5000); // 1 credit per 10 pesos
              if (creditsEarned > 0) {
                const currentCredits = customer.credits || 0;
                this.customerService.updateCustomer(customer.id, {
                  credits: currentCredits + creditsEarned,
                });

                this.loggingService.logActivity(
                  'update',
                  'customer',
                  customer.id,
                  customer.name,
                  `Awarded ${creditsEarned} credits for purchase`
                );
              }
            }
          }

          this.loggingService.logActivity(
            'complete',
            'sale',
            saleId,
            sale.productName,
            `Marked as delivered & Deducted ${sale.quantitySold} units`
          );
        },
        error: (err) => console.error('Error completing sale:', err),
      });
  }

  updateSale(sale: Sale): void {
    this.http.put<Sale>(`${this.apiUrl}/sales/${sale.id}`, sale).subscribe({
      next: (updatedSale) => {
        const currentSales = this.salesSubject.value;
        const updatedSales = currentSales.map((s) =>
          s.id === sale.id ? this.transformSale(updatedSale) : s
        );
        this.salesSubject.next(updatedSales);

        this.loggingService.logActivity(
          'update',
          'sale',
          sale.id,
          sale.productName,
          'Updated delivery details'
        );
      },
      error: (err) => console.error('Error updating sale:', err),
    });
  }

  confirmReservation(sale: Sale): void {
    const products = this.productsSubject.value;
    const product = products.find((p) => p.id === sale.productId);

    if (!product) {
      console.error('Product not found for confirmation stock deduction');
      return;
    }

    // 1. Update sale status to confirmed
    const updatedSale: Sale = { ...sale, reservationStatus: 'confirmed' };

    this.http
      .put<Sale>(`${this.apiUrl}/sales/${sale.id}`, updatedSale)
      .subscribe({
        next: (responseSale) => {
          // Update local sales
          const currentSales = this.salesSubject.value;
          const newSales = currentSales.map((s) =>
            s.id === sale.id ? this.transformSale(updatedSale) : s
          );
          this.salesSubject.next(newSales);

          // 2. No Stock Deduction on Confirmation (Only on Delivery)

          this.loggingService.logActivity(
            'update',
            'sale',
            sale.id,
            sale.productName,
            'Confirmed reservation (Stock deduction pending delivery)'
          );
        },
        error: (err) => console.error('Error confirming reservation:', err),
      });
  }

  private transformSale(sale: any): Sale {
    return {
      ...sale,
      timestamp: this.parseDate(sale.timestamp),
      deliveryDate: sale.deliveryDate
        ? this.parseDate(sale.deliveryDate)
        : undefined,
    };
  }

  private parseDate(date: any): Date {
    if (!date) return new Date();
    if (date instanceof Date) return date;

    // Handle Firestore Timestamp object (with toDate method)
    if (date && typeof date.toDate === 'function') {
      return date.toDate();
    }

    // Handle serialized Timestamp (JSON) or internal representation
    if (date && (date.seconds !== undefined || date._seconds !== undefined)) {
      const seconds = date.seconds ?? date._seconds;
      return new Date(seconds * 1000);
    }

    if (typeof date === 'string') return new Date(date);

    return new Date(date);
  }

  restockProduct(productId: string, quantityToAdd: number): void {
    const products = this.productsSubject.value;
    const product = products.find((p) => p.id === productId);

    if (product) {
      const updatedProduct = {
        ...product,
        quantity: product.quantity + quantityToAdd,
      };
      this.updateProduct(updatedProduct);
      this.loggingService.logActivity(
        'restock',
        'product',
        productId,
        product.name,
        `Added ${quantityToAdd} units`
      );
    }
  }

  deleteSale(saleId: string): void {
    this.http.delete(`${this.apiUrl}/sales/${saleId}`).subscribe({
      next: () => {
        const currentSales = this.salesSubject.value;
        const updatedSales = currentSales.filter((s) => s.id !== saleId);
        this.salesSubject.next(updatedSales);

        this.loggingService.logActivity(
          'delete',
          'sale',
          saleId,
          'Reservation/Sale',
          'Deleted sale record'
        );
      },
      error: (err) => console.error('Error deleting sale:', err),
    });
  }

  async updateProduct(product: Product): Promise<void> {
    // 1. Dual Write to Firestore (Best Effort)
    try {
      const firestoreData = { ...product, userId: this.getFirestoreUserId() };
      // Remove ID from data if needed, but setDoc handles it.
      // Actually updateDoc is better for existing.
      // If it doesn't exist (Legacy only item?), updateDoc fails.
      // setDoc with merge: true is safest.
      await setDoc(doc(this.db, 'products', product.id), firestoreData, {
        merge: true,
      });
    } catch (e) {
      console.warn('Firestore update failed (proceeding with Legacy):', e);
    }

    // 2. Legacy Backend
    this.http
      .put<Product>(`${this.apiUrl}/products/${product.id}`, product)
      .subscribe({
        next: () => {
          // Update products
          const currentProducts = this.productsSubject.value;
          const updatedProducts = currentProducts.map((p) =>
            p.id === product.id ? product : p
          );
          this.productsSubject.next(updatedProducts);

          // Update related sales (Pending and History)
          const currentSales = this.salesSubject.value;
          const salesToUpdate = currentSales.filter(
            (s) => s.productId === product.id && s.productName !== product.name
          );

          if (salesToUpdate.length > 0) {
            // Update local state immediately for responsiveness
            const updatedSales = currentSales.map((s) =>
              s.productId === product.id
                ? { ...s, productName: product.name }
                : s
            );
            this.salesSubject.next(updatedSales);

            // Update backend for each sale
            salesToUpdate.forEach((sale) => {
              const updatedSale = { ...sale, productName: product.name };
              this.http
                .put<Sale>(`${this.apiUrl}/sales/${sale.id}`, updatedSale)
                .subscribe({
                  error: (err) =>
                    console.error(`Error updating sale ${sale.id} name:`, err),
                });
            });
          }

          this.loggingService.logActivity(
            'update',
            'product',
            product.id,
            product.name
          );
        },
        error: (err) => console.error('Error updating product:', err),
      });
  }

  clearAllData(): void {
    // Optional: Implement API endpoint to clear all data if needed
    // For now, just clear local state
    this.productsSubject.next([]);
    this.salesSubject.next([]);
    this.expensesSubject.next([]);
  }

  migrateFromLocalStorage(): void {
    const productsData = localStorage.getItem('jjm_products');
    const salesData = localStorage.getItem('jjm_sales');
    const expensesData = localStorage.getItem('jjm_expenses');

    if (productsData) {
      const products: Product[] = JSON.parse(productsData);
      products.forEach((p) => this.addProduct(p));
    }

    if (salesData) {
      const sales: Sale[] = JSON.parse(salesData);
      // We need a way to add sales without triggering stock updates if they are already recorded
      // For simplicity, we'll just add them as records.
      // Ideally, the backend should handle bulk import or we check existence.
      // Here we just POST them.
      sales.forEach((s) => {
        this.http.post(`${this.apiUrl}/sales`, s).subscribe({
          error: (err) => console.error('Error migrating sale:', err),
        });
      });
    }

    if (expensesData) {
      const expenses: Expense[] = JSON.parse(expensesData);
      expenses.forEach((e) => this.addExpense(e));
    }

    console.log('Migration started...');
  }
}
