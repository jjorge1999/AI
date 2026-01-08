import { Injectable, signal, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  BehaviorSubject,
  Observable,
  tap,
  from,
  of,
  throwError,
  take,
} from 'rxjs';
import {
  map,
  switchMap,
  catchError,
  distinctUntilChanged,
} from 'rxjs/operators';
import {
  Product,
  Sale,
  Expense,
  Category,
  DashboardStats,
} from '../models/inventory.models';
import { environment } from '../../environments/environment';
import { LoggingService } from './logging.service';
import { CustomerService } from './customer.service';
import { FirebaseService } from './firebase.service';
import { StoreService } from './store.service';
import { MaintenanceService } from './maintenance.service';
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

  // State management using Signals (Performance Optimization)
  private readonly _products = signal<Product[]>([]);
  public readonly products = this._products.asReadonly();

  private readonly _sales = signal<Sale[]>([]);
  public readonly sales = this._sales.asReadonly();

  private readonly _expenses = signal<Expense[]>([]);
  public readonly expenses = this._expenses.asReadonly();

  private readonly _categories = signal<Category[]>([]);
  public readonly categories = this._categories.asReadonly();

  private readonly _stats = signal<DashboardStats | null>(null);
  public readonly stats = this._stats.asReadonly();

  private productsSubject = new BehaviorSubject<Product[]>([]);
  private salesSubject = new BehaviorSubject<Sale[]>([]);
  private expensesSubject = new BehaviorSubject<Expense[]>([]);
  private categoriesSubject = new BehaviorSubject<Category[]>([]);

  public products$ = this.productsSubject.asObservable();
  public sales$ = this.salesSubject.asObservable();
  public expenses$ = this.expensesSubject.asObservable();
  public categories$ = this.categoriesSubject.asObservable();

  private statsSubject = new BehaviorSubject<DashboardStats | null>(null);
  public stats$ = this.statsSubject.asObservable();

  private app: FirebaseApp;
  private db: Firestore;
  private auth;
  private firebaseUser: User | null = null;
  private unsubscribes: Unsubscribe[] = [];
  private pollingInterval: any = null;

  constructor(
    private readonly http: HttpClient,
    private readonly loggingService: LoggingService,
    private readonly customerService: CustomerService,
    private readonly firebaseService: FirebaseService,
    private readonly storeService: StoreService,
    private readonly maintenanceService: MaintenanceService
  ) {
    this.app = this.firebaseService.app;
    this.db = this.firebaseService.db;
    this.auth = getAuth(this.app);
    this.hydrateFromCache();

    // Auto-save to cache on changes
    effect(() => this.saveToCache('products', this._products()));
    effect(() => this.saveToCache('sales', this._sales()));
    effect(() => this.saveToCache('expenses', this._expenses()));
    effect(() => this.saveToCache('categories', this._categories()));
    effect(() => this.saveToCache('stats', this._stats()));
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

  public enableFullSync(): void {
    console.log('Enabling Full Firestore Sync...');
    localStorage.setItem('jjm_force_full_load', 'true');
    this.reloadData();
  }

  public stopRealtimeListeners(): void {
    this.unsubscribes.forEach((unsub) => unsub());
    this.unsubscribes = [];
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private hydrateFromCache(): void {
    try {
      const items = [
        {
          key: 'products',
          signal: this._products,
          subject: this.productsSubject,
        },
        { key: 'sales', signal: this._sales, subject: this.salesSubject },
        {
          key: 'expenses',
          signal: this._expenses,
          subject: this.expensesSubject,
        },
        {
          key: 'categories',
          signal: this._categories,
          subject: this.categoriesSubject,
        },
        { key: 'stats', signal: this._stats, subject: this.statsSubject },
      ];

      items.forEach((item) => {
        const cached = localStorage.getItem(`jjm_${item.key}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          item.signal.set(parsed);
          item.subject.next(parsed);
        }
      });
    } catch (e) {
      console.warn('InventoryService: Failed to hydrate from cache', e);
    }
  }

  private saveToCache(key: string, data: any): void {
    try {
      localStorage.setItem(`jjm_${key}`, JSON.stringify(data));
    } catch (e) {
      console.error(`InventoryService: Failed to save ${key} to cache`, e);
    }
  }

  private handleFirestoreError(err: any, context: string): void {
    console.error(`${context}:`, err);
    const isQuotaError =
      err.code === 'resource-exhausted' ||
      err.code === 8 ||
      err.status === 429 ||
      (err.message && err.message.toLowerCase().includes('quota')) ||
      (err.error &&
        err.error.message &&
        err.error.message.toLowerCase().includes('quota'));

    if (isQuotaError) {
      this.maintenanceService.setMaintenanceMode(
        true,
        'Firebase Quota Exhausted. System is in read-only maintenance mode.'
      );
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
    this.storeService.activeStoreId$
      .pipe(distinctUntilChanged())
      .subscribe((activeStoreId) => {
        // Re-setup all listeners when store changes
        this.doSetupFirestoreListeners(firestoreId, legacyId, activeStoreId);
      });
  }

  private doSetupFirestoreListeners(
    firestoreId: string,
    legacyId: string,
    activeStoreId: string | null
  ): void {
    // Stop previous listeners first to avoid memory leaks/multiple streams
    this.unsubscribes.forEach((unsub) => unsub());
    this.unsubscribes = [];

    this.setupStatsListener(activeStoreId);

    // Optimization: If NOT in Full Sync mode, skip raw data listeners to save quota/bandwidth.
    const isFullSync = localStorage.getItem('jjm_force_full_load') === 'true';
    const isCustomer = !!localStorage.getItem('customer_id');

    if (!isFullSync && !isCustomer) {
      console.log('Optimized Mode: Stats Only. Raw data listeners skipped.');
      return;
    }

    // Products
    // For customers, fetch ALL products so the AI can respond to inquiries
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
      // Seller Mode: Query by userId AND storeId
      productsQuery = query(
        collection(this.db, 'products'),
        where('userId', '==', legacyId)
      );

      if (activeStoreId) {
        productsQuery = query(
          collection(this.db, 'products'),
          where('userId', '==', legacyId),
          where('storeId', '==', activeStoreId)
        );
      }
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
          this._products.set(products);
          this.productsSubject.next(products);
          if (!isCustomer && products.length === 0) {
            this.migrateProducts(legacyId, firestoreId);
            this.migrateChat(legacyId, firestoreId);
          }
        },
        (err) => {
          if (err.code === 'permission-denied') {
            console.warn('Permission Denied. Falling back to Legacy Polling.');
            this.fallbackToLegacyPolling();
          } else {
            this.handleFirestoreError(err, 'Products Listener Error');
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
      // Seller Mode: Query by userId AND storeId
      salesQuery = query(
        collection(this.db, 'sales'),
        where('userId', '==', legacyId)
      );

      if (activeStoreId) {
        salesQuery = query(
          collection(this.db, 'sales'),
          where('userId', '==', legacyId),
          where('storeId', '==', activeStoreId)
        );
      }
    }

    this.unsubscribes.push(
      onSnapshot(
        salesQuery,
        (snapshot) => {
          console.log('Sales Snapshot:', snapshot.docs.length);
          const sales = snapshot.docs.map((doc) =>
            this.transformSale({ id: doc.id, ...doc.data() })
          );
          this._sales.set(sales);
          this.salesSubject.next(sales);
          // Only migrate if we are Admin/Seller and empty?
          if (!isCustomer && sales.length === 0) {
            this.migrateSales(legacyId, firestoreId);
          }
        },
        (err) => this.handleFirestoreError(err, 'Sales Listener Error')
      )
    );

    // Expenses
    let expensesQuery = query(
      collection(this.db, 'expenses'),
      where('userId', '==', firestoreId)
    );

    if (activeStoreId) {
      expensesQuery = query(
        collection(this.db, 'expenses'),
        where('userId', '==', firestoreId),
        where('storeId', '==', activeStoreId)
      );
    }
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
          this._expenses.set(expenses);
          this.expensesSubject.next(expenses);
          if (expenses.length === 0) {
            this.migrateExpenses(legacyId, firestoreId);
          }
        },
        (err) => this.handleFirestoreError(err, 'Expenses Listener Error')
      )
    );

    // Categories
    let categoriesQuery = query(
      collection(this.db, 'categories'),
      where('userId', '==', legacyId)
    );

    if (activeStoreId) {
      categoriesQuery = query(
        collection(this.db, 'categories'),
        where('userId', '==', legacyId),
        where('storeId', '==', activeStoreId)
      );
    }

    this.unsubscribes.push(
      onSnapshot(
        categoriesQuery,
        (snapshot) => {
          console.log('Categories Snapshot:', snapshot.docs.length);
          const categories = snapshot.docs.map(
            (doc) =>
              ({
                id: doc.id,
                ...(doc.data() as any),
              } as Category)
          );
          this._categories.set(categories);
          this.categoriesSubject.next(categories);
        },
        (err) => this.handleFirestoreError(err, 'Categories Listener Error')
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

  private setupStatsListener(storeId: string | null): void {
    if (!storeId) return;

    const statsRef = doc(this.db, 'stats', storeId);
    this.unsubscribes.push(
      onSnapshot(
        statsRef,
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            const stats = {
              ...data,
              lastUpdated:
                data['lastUpdated'] instanceof Timestamp
                  ? data['lastUpdated'].toDate()
                  : new Date(data['lastUpdated']),
            } as DashboardStats;
            this._stats.set(stats);
            this.statsSubject.next(stats);
            // Also update legacy subject for components still using stats$ (like Landing)
          } else {
            console.log('No aggregation document found for this store.');
            this._stats.set(null);
            this.statsSubject.next(null);
          }
        },
        (err) => this.handleFirestoreError(err, 'Stats Listener Error')
      )
    );
  }

  private migrateProducts(legacyId: string, firestoreId: string): void {
    const storeId = this.storeService.getActiveStoreId();
    this.http
      .get<Product[]>(`${this.apiUrl}/products?userId=${legacyId}`)
      .subscribe((products) => {
        products.forEach(async (p) => {
          try {
            await setDoc(doc(this.db, 'products', p.id), {
              ...p,
              userId: firestoreId,
              storeId: p.storeId || storeId || null,
            });
          } catch (e) {
            console.error('Error migrating product:', e);
          }
        });
      });
  }

  private migrateChat(legacyId: string, firestoreId: string): void {
    const storeId = this.storeService.getActiveStoreId();
    this.http
      .get<any[]>(`${this.apiUrl}/messages?userId=${legacyId}`)
      .subscribe((msgs) => {
        msgs.forEach(async (m) => {
          try {
            await setDoc(doc(this.db, 'messages', m.id), {
              ...m,
              userId: firestoreId,
              storeId: m.storeId || storeId || null,
              timestamp: this.parseDate(m.timestamp),
            });
          } catch (e) {
            console.error('Error migrating message:', e);
          }
        });
      });
  }

  private migrateSales(legacyId: string, firestoreId: string): void {
    const storeId = this.storeService.getActiveStoreId();
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
              storeId: s.storeId || storeId || null,
            };
            await setDoc(doc(this.db, 'sales', s.id), data);
          } catch (e) {
            console.error('Error migrating sale:', e);
          }
        });
      });
  }

  private migrateExpenses(legacyId: string, firestoreId: string): void {
    const storeId = this.storeService.getActiveStoreId();
    this.http
      .get<Expense[]>(`${this.apiUrl}/expenses?userId=${legacyId}`)
      .subscribe((expenses) => {
        expenses.forEach(async (e) => {
          try {
            const data = {
              ...e,
              timestamp: this.parseDate(e.timestamp),
              userId: firestoreId,
              storeId: e.storeId || storeId || null,
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

  /**
   * Load products for a specific user (e.g., for public reservation page)
   * @param userId - The userId to fetch products for (e.g., 'admin-1')
   */
  public loadProductsForUser(userId: string): void {
    const url = `${this.apiUrl}/products?userId=${userId}`;
    this.http.get<Product[]>(url).subscribe({
      next: (products) => this.productsSubject.next(products),
      error: (err) => console.error('Error fetching products for user:', err),
    });
  }

  private fetchProducts(): void {
    const activeStoreId = this.storeService.getActiveStoreId();

    if (!activeStoreId) {
      this.productsSubject.next([]);
      return;
    }

    const userId = this.getCurrentUser();
    let url = `${this.apiUrl}/products`;
    const params = new URLSearchParams();
    if (userId && userId !== 'guest') params.append('userId', userId);
    params.append('storeId', activeStoreId);

    const queryString = params.toString();
    url += `?${queryString}`;

    this.http.get<Product[]>(url).subscribe({
      next: (products) => this.productsSubject.next(products),
      error: (err) => console.error('Error fetching products:', err),
    });
  }

  private fetchSales(): void {
    const userId = this.getCurrentUser();
    const activeStoreId = this.storeService.getActiveStoreId();

    if (!userId || userId === 'guest' || !activeStoreId) {
      if (!activeStoreId) this.salesSubject.next([]);
      return;
    }

    const url = `${this.apiUrl}/sales?userId=${userId}&storeId=${activeStoreId}`;

    this.http.get<Sale[]>(url).subscribe({
      next: (sales) => {
        const parsedSales = sales.map((sale) => this.transformSale(sale));
        this.salesSubject.next(parsedSales);
      },
      error: (err) => console.error('Error fetching sales:', err),
    });
  }

  private fetchExpenses(): void {
    const userId = this.getCurrentUser();
    const activeStoreId = this.storeService.getActiveStoreId();

    if (!userId || userId === 'guest' || !activeStoreId) {
      if (!activeStoreId) this.expensesSubject.next([]);
      return;
    }

    const url = `${this.apiUrl}/expenses?userId=${userId}&storeId=${activeStoreId}`;

    this.http.get<Expense[]>(url).subscribe({
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

  getCategories(): Observable<Category[]> {
    return this.categories$;
  }

  addCategory(name: string): Observable<Category> {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    const baseData = {
      name,
      createdAt: new Date(),
      storeId: activeStoreId,
      userId: this.getCurrentUser(),
    };

    return from(addDoc(collection(this.db, 'categories'), baseData)).pipe(
      map((docRef) => ({ id: docRef.id, ...baseData } as Category)),
      tap((newCategory) => {
        const current = this.categoriesSubject.value;
        this.categoriesSubject.next([...current, newCategory]);
      }),
      catchError((err) => {
        this.handleFirestoreError(err, 'Error adding category');
        return throwError(() => err);
      })
    );
  }

  deleteCategory(categoryId: string): Observable<void> {
    return from(deleteDoc(doc(this.db, 'categories', categoryId))).pipe(
      tap(() => {
        const current = this.categoriesSubject.value;
        this.categoriesSubject.next(current.filter((c) => c.id !== categoryId));
      }),
      catchError((err) => {
        this.handleFirestoreError(err, 'Error deleting category');
        return throwError(() => err);
      })
    );
  }

  addExpense(expense: Omit<Expense, 'id' | 'timestamp'>): Observable<Expense> {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    const baseData = {
      ...expense,
      timestamp: new Date(),
      storeId: activeStoreId,
    };

    const firestoreData = { ...baseData, userId: this.getFirestoreUserId() };

    return from(addDoc(collection(this.db, 'expenses'), firestoreData)).pipe(
      map((docRef) => docRef.id),
      catchError((e) => {
        console.warn('Firestore write failed (proceeding with Legacy):', e);
        return of(undefined);
      }),
      switchMap((firestoreId) => {
        const legacyData = { ...baseData, userId: this.getCurrentUser() };
        if (firestoreId) {
          Object.assign(legacyData, { id: firestoreId });
        }
        return this.http.post<Expense>(`${this.apiUrl}/expenses`, legacyData);
      }),
      tap({
        next: (newExpense) => {
          const current = this.expensesSubject.value;
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
      })
    );
  }

  deleteExpense(expenseId: string): Observable<void> {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    return from(deleteDoc(doc(this.db, 'expenses', expenseId))).pipe(
      catchError((e) => {
        console.warn('Firestore delete failed (proceeding with Legacy):', e);
        return of(void 0);
      }),
      switchMap(() =>
        this.http.delete<void>(`${this.apiUrl}/expenses/${expenseId}`)
      ),
      tap({
        next: () => {
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
      })
    );
  }

  addProduct(product: Omit<Product, 'id' | 'createdAt'>): Observable<Product> {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    return this.storeService.stores$.pipe(
      take(1),
      switchMap((stores) => {
        const store = stores.find((s) => s.id === activeStoreId);
        // Free Plan Check
        const plan = store?.subscriptionPlan || 'Free';
        const currentCount = this.productsSubject.value.length;
        let limit = Infinity;

        if (plan === 'Free') {
          limit = 10;
        } else if (plan === 'Starter' || (plan as string).includes('Starter')) {
          limit = 2000;
        }

        if (currentCount >= limit) {
          return throwError(
            () =>
              new Error(
                `Product Limit Reached for ${plan} plan (${limit}). Upgrade to store more.`
              )
          );
        }

        const baseData = {
          ...product,
          createdAt: new Date(),
          storeId: activeStoreId,
        };

        const firestoreData = {
          ...baseData,
          userId: this.getFirestoreUserId(),
        };

        return from(
          addDoc(collection(this.db, 'products'), firestoreData)
        ).pipe(
          map((docRef) => docRef.id),
          catchError((e) => {
            console.warn('Firestore write failed:', e);
            return of(undefined);
          }),
          switchMap((firestoreId) => {
            const legacyData = { ...baseData, userId: this.getCurrentUser() };
            if (firestoreId) Object.assign(legacyData, { id: firestoreId });
            return this.http.post<Product>(
              `${this.apiUrl}/products`,
              legacyData
            );
          }),
          tap({
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
              this.recalculateAndSaveStats();
            },
            error: (err) =>
              this.handleFirestoreError(err, 'Error adding product'),
          })
        );
      })
    );
  }

  deleteProduct(productId: string): Observable<void> {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    const products = this.productsSubject.value;
    const product = products.find((p) => p.id === productId);

    return from(deleteDoc(doc(this.db, 'products', productId))).pipe(
      catchError((e) => {
        console.warn('Firestore delete failed (proceeding with Legacy):', e);
        return of(void 0);
      }),
      switchMap(() =>
        this.http.delete<void>(`${this.apiUrl}/products/${productId}`)
      ),
      tap({
        next: () => {
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
      })
    );
  }

  recordSale(
    productId: string,
    quantitySold: number,
    cashReceived: number,
    deliveryDate?: Date,
    deliveryNotes?: string,
    customerId?: string,
    discount: number = 0,
    discountType: 'amount' | 'percent' = 'amount',
    orderId?: string
  ): Observable<Sale> {
    const products = this.productsSubject.value;
    const product = products.find((p) => p.id === productId);

    if (!product) {
      return throwError(() => new Error('Product not found'));
    }

    if (product.quantity < quantitySold) {
      return throwError(() => new Error('Insufficient quantity'));
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
      return throwError(() => new Error('Insufficient cash'));
    }

    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    return this.storeService.stores$.pipe(
      take(1),
      switchMap((stores) => {
        const store = stores.find((s) => s.id === activeStoreId);

        // Transaction Limit Check
        // Check Transaction Limits (Credit Based)
        if (!this.storeService.hasTransactionCredits(activeStoreId)) {
          return throwError(
            () =>
              new Error(
                'Transaction Limit Reached. Please Upgrade to Pro or Top Up.'
              )
          );
        }

        const baseData: Record<string, any> = {
          productId: product.id,
          productName: product.name,
          category: product.category,
          price: product.price,
          quantitySold,
          total,
          cashReceived,
          change,
          pending: true,
          discount,
          discountType,
          timestamp: new Date(),
          storeId: activeStoreId,
        };

        // Only add optional fields if they have values (Firebase doesn't accept undefined)
        if (deliveryDate) baseData['deliveryDate'] = deliveryDate;
        if (deliveryNotes) baseData['deliveryNotes'] = deliveryNotes;
        if (customerId) baseData['customerId'] = customerId;
        if (orderId) baseData['orderId'] = orderId;

        const firestoreData = {
          ...baseData,
          userId: this.getFirestoreUserId(),
        };

        return from(addDoc(collection(this.db, 'sales'), firestoreData)).pipe(
          map((docRef) => docRef.id),
          catchError((e) => {
            console.warn('Firestore Sale Write Failed:', e);
            return of(undefined);
          }),
          switchMap((firestoreId) => {
            const legacyData = { ...baseData, userId: this.getCurrentUser() };
            if (firestoreId) Object.assign(legacyData, { id: firestoreId });
            return this.http.post<Sale>(`${this.apiUrl}/sales`, legacyData);
          }),
          tap({
            next: (newSale) => {
              // Deduct Credit on Success
              this.storeService.deductTransactionCredit(activeStoreId);

              // Update local sales state
              const transformed = this.transformSale(newSale);
              const currentSales = this._sales();
              if (!currentSales.find((s) => s.id === transformed.id)) {
                const updated = [...currentSales, transformed];
                this._sales.set(updated);
                this.salesSubject.next(updated);
              }

              this.loggingService.logActivity(
                'create',
                'sale',
                newSale.id,
                product.name,
                `Sold ${quantitySold} units (Pending Delivery)`
              );
              this.recalculateAndSaveStats();
            },
            error: (err) => console.error('Error recording sale:', err),
          })
        );
      })
    );
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
            this.updateProduct(updatedProduct).subscribe();
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
          this.recalculateAndSaveStats();
        },
        error: (err) => console.error('Error completing sale:', err),
      });
  }

  updateSale(sale: Sale): void {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      console.error('Store selection required to update sale.');
      return;
    }

    this.http
      .put<Sale>(`${this.apiUrl}/sales/${sale.id}`, {
        ...sale,
        storeId: activeStoreId,
      })
      .subscribe({
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
      this.updateProduct(updatedProduct).subscribe();
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
        const currentSales = this._sales();
        const updatedSales = currentSales.filter((s) => s.id !== saleId);
        this._sales.set(updatedSales);
        this.salesSubject.next(updatedSales);

        this.loggingService.logActivity(
          'delete',
          'sale',
          saleId,
          'Reservation/Sale',
          'Deleted sale record'
        );
        this.recalculateAndSaveStats();
      },
      error: (err) => console.error('Error deleting sale:', err),
    });
  }

  updateProduct(product: Product): Observable<Product> {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    const firestoreData = {
      ...product,
      storeId: activeStoreId,
      userId: this.getFirestoreUserId(),
    };

    return from(
      setDoc(doc(this.db, 'products', product.id), firestoreData, {
        merge: true,
      })
    ).pipe(
      catchError((e) => {
        console.warn('Firestore update failed (proceeding with Legacy):', e);
        return of(void 0);
      }),
      switchMap(() =>
        this.http.put<Product>(`${this.apiUrl}/products/${product.id}`, product)
      ),
      tap({
        next: () => {
          // Update products
          const currentProducts = this._products();
          const updatedProducts = currentProducts.map((p) =>
            p.id === product.id ? product : p
          );
          this._products.set(updatedProducts);
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
            this._sales.set(updatedSales);
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
          this.recalculateAndSaveStats();
        },
        error: (err) => console.error('Error updating product:', err),
      })
    );
  }

  public recalculateAndSaveStats(): void {
    const storeId = this.storeService.getActiveStoreId();
    if (!storeId) return;

    const products = this.productsSubject.value;
    const sales = this.salesSubject.value;

    const totalRevenue = sales.reduce((sum, s) => sum + (s.total || 0), 0);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const mtdRevenue = sales
      .filter((s) => new Date(s.timestamp) >= startOfMonth)
      .reduce((sum, s) => sum + (s.total || 0), 0);

    const todayStr = now.toISOString().split('T')[0];
    const todaySales = sales.filter(
      (s) => new Date(s.timestamp).toISOString().split('T')[0] === todayStr
    );
    const todayRevenue = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);
    const todayOrdersCount = todaySales.length;

    const totalProductsCount = products.length;
    const lowStockCount = products.filter((p) => (p.quantity || 0) <= 5).length;

    // Top Selling Products
    const productSalesMap: {
      [key: string]: { name: string; units: number; rev: number };
    } = {};
    sales.forEach((s) => {
      const key = s.productId || s.productName;
      if (!productSalesMap[key])
        productSalesMap[key] = { name: s.productName, units: 0, rev: 0 };
      productSalesMap[key].units += s.quantitySold || 1;
      productSalesMap[key].rev += s.total || 0;
    });
    const topSellingProducts = Object.values(productSalesMap)
      .sort((a, b) => b.rev - a.rev)
      .slice(0, 5)
      .map((p) => ({ name: p.name, unitsSold: p.units, revenue: p.rev }));

    // Category Distribution
    const catMap: { [key: string]: number } = {};
    products.forEach((p) => {
      const cat = p.category || 'Others';
      catMap[cat] = (catMap[cat] || 0) + 1;
    });
    const categoryDistribution = Object.entries(catMap).map(
      ([name, count]) => ({
        name,
        percentage: Math.round((count / (products.length || 1)) * 100),
      })
    );

    // Recent Orders
    const recentOrders = [...sales]
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, 5);

    // Top Customers
    const customerSalesMap: {
      [key: string]: { name: string; totalSpent: number; ordersCount: number };
    } = {};
    sales.forEach((s) => {
      const key = s.customerId || s.customerName || 'Walk-in';
      if (!customerSalesMap[key])
        customerSalesMap[key] = {
          name: s.customerName || 'Customer',
          totalSpent: 0,
          ordersCount: 0,
        };
      customerSalesMap[key].totalSpent += s.total || 0;
      customerSalesMap[key].ordersCount += 1;
    });
    const topCustomers = Object.values(customerSalesMap)
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 5);

    const stats: DashboardStats = {
      totalRevenue,
      mtdRevenue,
      todayRevenue,
      todayOrdersCount,
      totalProductsCount,
      lowStockCount,
      lastUpdated: new Date(),
      storeId,
      topSellingProducts,
      categoryDistribution,
      recentOrders,
      topCustomers,
    };

    setDoc(doc(this.db, 'stats', storeId), stats).catch((err) =>
      console.error('Error updating aggregation document:', err)
    );
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
      products.forEach((p) => this.addProduct(p).subscribe());
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
      expenses.forEach((e) => this.addExpense(e).subscribe());
    }

    console.log('Migration started...');
  }
}
