import { Injectable, signal, effect } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  tap,
  from,
  of,
  throwError,
  take,
  forkJoin,
} from 'rxjs';
import {
  map,
  switchMap,
  catchError,
  distinctUntilChanged,
  finalize,
} from 'rxjs/operators';
import {
  Product,
  RawMaterial,
  Sale,
  Expense,
  Category,
  DashboardStats,
  NotificationTypes,
} from '../models/inventory.models';
import { LoggingService } from './logging.service';
import { CustomerService } from './customer.service';
import { FirebaseService } from './firebase.service';
import { StoreService } from './store.service';
import { MaintenanceService } from './maintenance.service';
import { LoadingService } from './loading.service';
import { NotificationService } from './notification.service';
import { IndexedDbService } from './indexed-db.service';
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
  getDocs,
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
  // State management using Signals (Performance Optimization)
  private readonly _products = signal<Product[]>([]);
  public readonly products = this._products.asReadonly();

  private readonly _sales = signal<Sale[]>([]);
  public readonly sales = this._sales.asReadonly();

  private readonly _expenses = signal<Expense[]>([]);
  public readonly expenses = this._expenses.asReadonly();

  private readonly _categories = signal<Category[]>([]);
  public readonly categories = this._categories.asReadonly();

  private readonly _rawMaterials = signal<RawMaterial[]>([]);
  public readonly rawMaterials = this._rawMaterials.asReadonly();

  private readonly _stats = signal<DashboardStats | null>(null);
  public readonly stats = this._stats.asReadonly();

  // Initialization state to prevent UI flickering
  private readonly _initialized = signal<boolean>(false);
  public readonly initialized = this._initialized.asReadonly();

  private productsSubject = new BehaviorSubject<Product[]>([]);
  private salesSubject = new BehaviorSubject<Sale[]>([]);
  private expensesSubject = new BehaviorSubject<Expense[]>([]);
  private categoriesSubject = new BehaviorSubject<Category[]>([]);
  private rawMaterialsSubject = new BehaviorSubject<RawMaterial[]>([]);

  public products$ = this.productsSubject.asObservable();
  public sales$ = this.salesSubject.asObservable();
  public expenses$ = this.expensesSubject.asObservable();
  public categories$ = this.categoriesSubject.asObservable();
  public rawMaterials$ = this.rawMaterialsSubject.asObservable();

  private statsSubject = new BehaviorSubject<DashboardStats | null>(null);
  public stats$ = this.statsSubject.asObservable();

  private app: FirebaseApp;
  private db: Firestore;
  private auth;
  private firebaseUser: User | null = null;
  private unsubscribes: Unsubscribe[] = [];
  private pollingInterval: any = null;

  constructor(
    private readonly loggingService: LoggingService,
    private readonly customerService: CustomerService,
    private readonly firebaseService: FirebaseService,
    private readonly storeService: StoreService,
    private readonly maintenanceService: MaintenanceService,
    private readonly notificationService: NotificationService,
    private readonly indexedDbService: IndexedDbService,
    private readonly loadingService: LoadingService
  ) {
    this.app = this.firebaseService.app;
    this.db = this.firebaseService.db;
    this.auth = getAuth(this.app);
    // Remove direct hydrateFromCache call in favor of reactive subscription
    // this.hydrateFromCache();

    // Reactively hydrate when active store changes
    this.storeService.activeStoreId$.subscribe((storeId) => {
      if (storeId) {
        this.hydrateFromCache();
      }
    });

    // Auto-save to cache on changes
    effect(() => this.saveToCache('products', this._products()));
    effect(() => this.saveToCache('sales', this._sales()));
    effect(() => this.saveToCache('expenses', this._expenses()));
    effect(() => this.saveToCache('categories', this._categories()));
    effect(() => this.saveToCache('rawMaterials', this._rawMaterials()));
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

    // console.warn(
    //   'Firestore User ID requested but not authenticated. Using legacy fallback.'
    // );
    return this.getCurrentUser();
  }

  public reloadData(): void {
    this.startRealtimeListeners();
  }

  public enableFullSync(): void {
    // console.log('Enabling Full Firestore Sync...');
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

  /**
   * Clears all in-memory data and stops listeners.
   * Call this on logout to ensure clean state.
   */
  public clearAllData(): void {
    // console.log('InventoryService: Clearing all data...');

    // Stop all listeners
    this.stopRealtimeListeners();

    // Reset listener initialization flag
    this.listenersInitialized = false;

    // Clear all signals
    this._products.set([]);
    this._sales.set([]);
    this._expenses.set([]);
    this._categories.set([]);
    this._rawMaterials.set([]);
    this._stats.set({
      totalRevenue: 0,
      mtdRevenue: 0,
      todayRevenue: 0,
      totalProfit: 0,
      mtdProfit: 0,
      todayProfit: 0,
      todayOrdersCount: 0,
      totalProductsCount: 0,
      lowStockCount: 0,
      lastUpdated: new Date(),
      storeId: '',
    });

    // Clear all subjects
    this.productsSubject.next([]);
    this.salesSubject.next([]);
    this.expensesSubject.next([]);
    this.categoriesSubject.next([]);
    this.rawMaterialsSubject.next([]);
    this.statsSubject.next(this._stats());

    // Clear Firebase user reference
    this.firebaseUser = null;
  }

  private hydrateFromCache(): void {
    const storeId = this.storeService.getActiveStoreId();
    if (!storeId) {
      // console.log(
      //   'InventoryService: No store context - skipping cache hydration for security.'
      // );
      this._initialized.set(true);
      return;
    }

    this.loadingService.show('Loading data...');

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
      {
        key: 'rawMaterials',
        signal: this._rawMaterials,
        subject: this.rawMaterialsSubject,
      },
      { key: 'stats', signal: this._stats, subject: this.statsSubject },
    ];

    const observables = items.map((item) => {
      const cacheKey = `jjm_${storeId}_${item.key}`;
      return this.indexedDbService.get(cacheKey).pipe(
        take(1),
        tap((cached) => {
          if (cached) {
            item.signal.set(cached);
            item.subject.next(cached);
            // console.log(
            //   `Hydrated ${item.key} from IndexedDB for store ${storeId}`
            // );
          }
        }),
        catchError((err) => {
          // console.warn(`Failed to hydrate ${item.key}`, err);
          return of(null);
        })
      );
    });

    forkJoin(observables).subscribe({
      next: () => {
        this._initialized.set(true);
        this.loadingService.hide();
      },
      error: (err) => {
        console.error('InventoryService: Error during hydration', err);
        this._initialized.set(true);
        this.loadingService.hide();
      },
    });
  }

  private saveToCache(key: string, data: any): void {
    // SECURITY: Only save cache with store context
    const storeId = this.storeService.getActiveStoreId();
    if (!storeId || !data) return;

    // Async save to IndexedDB (fire and forget)
    const cacheKey = `jjm_${storeId}_${key}`;
    this.indexedDbService
      .set(cacheKey, data)
      .pipe(take(1))
      .subscribe({
        error: (err) => {},
        // console.error(
        //   `InventoryService: Failed to save ${key} to cache`,
        //   err
        // ),
      });
  }

  private handleFirestoreError(err: any, context: string): void {
    // console.error(`${context}:`, err);
    if (err.code === 'permission-denied') {
      // console.warn(
      //   `PERMISSIONS ERROR in ${context}: The client is blocked from accessing this data. Please update Firestore Security Rules to allow access.`
      // );
    }

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
      // console.log('Auth previously failed. Skipping to Public/Fallback Mode.');
      this.setupFirestoreListeners(legacyUserId, legacyUserId);
      return;
    }

    // 1. Check if we already have a user
    const currentUser = this.auth.currentUser;
    if (currentUser) {
      // console.log('Already Authenticated. Starting Secure Listeners.');
      this.firebaseUser = currentUser;
      this.setupFirestoreListeners(currentUser.uid, legacyUserId);
      return;
    }

    // 2. Try to Sign In
    from(signInAnonymously(this.auth)).subscribe({
      next: (cred) => {
        // console.log('Signed In Anonymously. Starting Secure Listeners.');
        this.firebaseUser = cred.user;
        this.setupFirestoreListeners(cred.user.uid, legacyUserId);
      },
      error: (err) => {
        // console.warn(
        //   'Anonymous Auth unavailable. Attempting Public Realtime Mode with Legacy ID.'
        // );
        // Cache the failure so we don't spam 400 errors on reload
        localStorage.setItem('firebase_auth_disabled', 'true');

        // 3. Fallback to Public Mode (using Legacy ID as Firestore ID)
        this.setupFirestoreListeners(legacyUserId, legacyUserId);
      },
    });
  }

  private listenersInitialized = false;
  private storeSubscription: any = null;
  private cachedFirestoreId: string = '';
  private cachedLegacyId: string = '';

  private setupFirestoreListeners(firestoreId: string, legacyId: string): void {
    // Cache credentials for refresh calls
    this.cachedFirestoreId = firestoreId;
    this.cachedLegacyId = legacyId;

    // Only subscribe to store changes ONCE
    if (this.listenersInitialized) {
      // Already subscribed - just trigger a refresh with current store
      const currentStoreId = this.storeService.getActiveStoreId();
      this.doSetupFirestoreListeners(firestoreId, legacyId, currentStoreId);
      return;
    }

    this.listenersInitialized = true;
    this.storeSubscription = this.storeService.activeStoreId$
      .pipe(distinctUntilChanged())
      .subscribe((activeStoreId) => {
        // Re-setup all listeners when store changes
        this.doSetupFirestoreListeners(
          this.cachedFirestoreId,
          this.cachedLegacyId,
          activeStoreId
        );
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

    // SECURITY: Hydrate cache for the NEW store (data is keyed by storeId)
    // This ensures we load the correct store's data, not another store's
    if (activeStoreId) {
      this.hydrateFromCache();
    }

    this.setupStatsListener(activeStoreId);

    // For Admin/Staff, always sync raw data for the active store
    // (Old optimization was skipping these, leading to stale lists)
    const isCustomer = !!localStorage.getItem('customer_id');

    this.setupProductsListener(
      activeStoreId,
      legacyId,
      firestoreId,
      isCustomer
    );
    this.setupSalesListener(activeStoreId, legacyId, firestoreId, isCustomer);
    this.setupExpensesListener(activeStoreId, legacyId, firestoreId);
    this.loadCategories(activeStoreId);
    this.loadRawMaterials(activeStoreId);
  }

  private setupProductsListener(
    activeStoreId: string | null,
    legacyId: string,
    firestoreId: string,
    isCustomer: boolean
  ): void {
    let productsQuery;

    if (isCustomer) {
      // console.log(
      //   'InventoryService: Customer Mode - Fetching ALL products for AI'
      // );
      productsQuery = query(
        collection(this.db, 'products'),
        orderBy('name', 'asc'),
        limit(100)
      );
    } else {
      if (activeStoreId) {
        productsQuery = query(
          collection(this.db, 'products'),
          where('storeId', '==', activeStoreId)
        );
      } else {
        productsQuery = query(
          collection(this.db, 'products'),
          where('storeId', '==', 'none')
        );
      }
    }

    this.unsubscribes.push(
      onSnapshot(
        productsQuery,
        (snapshot) => {
          // console.log('Products Snapshot:', snapshot.docs.length);
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
            // console.warn('Permission Denied. Falling back to Legacy Polling.');
            this.fallbackToLegacyPolling();
          } else {
            this.handleFirestoreError(err, 'Products Listener Error');
          }
        }
      )
    );
  }

  private setupSalesListener(
    activeStoreId: string | null,
    legacyId: string,
    firestoreId: string,
    isCustomer: boolean
  ): void {
    let salesQuery;

    if (isCustomer) {
      // console.log(
      //   'InventoryService: Customer Mode - Querying RECENT sales for fuzzy matching'
      // );
      salesQuery = query(
        collection(this.db, 'sales'),
        orderBy('timestamp', 'desc'),
        limit(100)
      );
    } else {
      if (activeStoreId) {
        salesQuery = query(
          collection(this.db, 'sales'),
          where('storeId', '==', activeStoreId)
        );
      } else {
        salesQuery = query(
          collection(this.db, 'sales'),
          where('storeId', '==', 'none')
        );
      }
    }

    this.unsubscribes.push(
      onSnapshot(
        salesQuery,
        (snapshot) => {
          // console.log('Sales Snapshot:', snapshot.docs.length);
          const sales = snapshot.docs.map((doc) =>
            this.transformSale({ id: doc.id, ...doc.data() })
          );
          this._sales.set(sales);
          this.salesSubject.next(sales);
          if (!isCustomer && sales.length === 0) {
            this.migrateSales(legacyId, firestoreId);
          }
        },
        (err) => this.handleFirestoreError(err, 'Sales Listener Error')
      )
    );
  }

  private setupExpensesListener(
    activeStoreId: string | null,
    legacyId: string,
    firestoreId: string
  ): void {
    let expensesQuery;
    if (activeStoreId) {
      expensesQuery = query(
        collection(this.db, 'expenses'),
        where('storeId', '==', activeStoreId)
      );
    } else {
      expensesQuery = query(
        collection(this.db, 'expenses'),
        where('storeId', '==', 'none')
      );
    }
    this.unsubscribes.push(
      onSnapshot(
        expensesQuery,
        (snapshot) => {
          // console.log('Expenses Snapshot:', snapshot.docs.length);
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
  }

  private loadCategories(activeStoreId: string | null): void {
    if (!activeStoreId) return;

    // TTL Check: Use cached data if < 5 mins old
    const CACHE_TTL = 5 * 60 * 1000;
    const lastFetch = Number(
      localStorage.getItem(`jjm_${activeStoreId}_categories_ts`) || 0
    );
    const now = Date.now();

    if (now - lastFetch < CACHE_TTL) {
      // console.log(
      //   'InventoryService: Categories cache is fresh. Skipping network fetch.'
      // );
      // Data is already hydrated in constructor via hydrateFromCache
      return;
    }

    let categoriesQuery = query(
      collection(this.db, 'categories'),
      where('storeId', '==', activeStoreId)
    );

    from(getDocs(categoriesQuery)).subscribe({
      next: (snapshot) => {
        // console.log('Categories Fetched:', snapshot.docs.length);
        const categories = snapshot.docs.map(
          (doc) =>
            ({
              id: doc.id,
              ...(doc.data() as any),
            } as Category)
        );
        const uniqueCategories: Category[] = [];
        const seenNames = new Set<string>();

        categories.forEach((cat) => {
          const normalized = cat.name.trim().toLowerCase();
          if (!seenNames.has(normalized)) {
            seenNames.add(normalized);
            uniqueCategories.push(cat);
          }
        });

        this._categories.set(uniqueCategories);
        this.categoriesSubject.next(uniqueCategories);

        // Update Timestamp
        localStorage.setItem(
          `jjm_${activeStoreId}_categories_ts`,
          now.toString()
        );
      },
      error: (err) => this.handleFirestoreError(err, 'Categories Fetch Error'),
    });
  }

  private loadRawMaterials(activeStoreId: string | null): void {
    if (!activeStoreId) return;

    // TTL Check
    const CACHE_TTL = 5 * 60 * 1000;
    const lastFetch = Number(
      localStorage.getItem(`jjm_${activeStoreId}_rawMaterials_ts`) || 0
    );
    const now = Date.now();

    if (now - lastFetch < CACHE_TTL) {
      // console.log(
      //   'InventoryService: RawMaterials cache is fresh. Skipping network fetch.'
      // );
      return;
    }

    let rawMaterialsQuery = query(
      collection(this.db, 'rawMaterials'),
      where('storeId', '==', activeStoreId)
    );

    from(getDocs(rawMaterialsQuery)).subscribe({
      next: (snapshot) => {
        const rawMaterials = snapshot.docs.map(
          (doc) =>
            ({
              id: doc.id,
              ...(doc.data() as any),
            } as RawMaterial)
        );
        this._rawMaterials.set(rawMaterials);
        this.rawMaterialsSubject.next(rawMaterials);

        localStorage.setItem(
          `jjm_${activeStoreId}_rawMaterials_ts`,
          now.toString()
        );
      },
      error: (err) =>
        this.handleFirestoreError(err, 'Raw Materials Fetch Error'),
    });
  }

  private fallbackToLegacyPolling(): void {
    if (this.pollingInterval) return; // Already polling
    // console.log('Starting Legacy Polling (Fallback Mode)...');

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
          } else {
            // console.log('No aggregation document found for this store.');
            this._stats.set(null);
            this.statsSubject.next(null);

            // Check if we have cached data for THIS STORE to display
            const hasCachedProducts = localStorage.getItem(
              `jjm_${storeId}_products`
            );
            const hasCachedSales = localStorage.getItem(`jjm_${storeId}_sales`);
            const isFullSync =
              localStorage.getItem('jjm_force_full_load') === 'true';

            // Only enable Full Sync if NO cached data exists AND not already in Full Sync
            // This preserves quota optimization while ensuring dashboard has data
            if (!isFullSync && !hasCachedProducts && !hasCachedSales) {
              // console.log(
              //   'No cached data found for this store. Enabling Full Sync to fetch raw data...'
              // );
              this.enableFullSync();
            } else if (hasCachedProducts || hasCachedSales) {
              // console.log('Using cached data for this store. Quota preserved.');
            }
          }
        },
        (err) => this.handleFirestoreError(err, 'Stats Listener Error')
      )
    );
  }

  // Migration methods are deprecated - data is already in Firestore
  private migrateProducts(legacyId: string, firestoreId: string): void {
    // console.log(
    //   'Migration deprecated - data should already exist in Firestore'
    // );
  }

  private migrateChat(legacyId: string, firestoreId: string): void {
    // console.log(
    //   'Migration deprecated - data should already exist in Firestore'
    // );
  }

  private migrateSales(legacyId: string, firestoreId: string): void {
    // console.log(
    //   'Migration deprecated - data should already exist in Firestore'
    // );
  }

  private migrateExpenses(legacyId: string, firestoreId: string): void {
    // console.log(
    //   'Migration deprecated - data should already exist in Firestore'
    // );
  }

  public loadProducts(): void {
    // Products are loaded via realtime listeners, no separate fetch needed
    // console.log('Products loading handled by realtime listeners');
  }

  /**
   * Load products for a specific store (e.g., for public reservation page)
   * @param storeId - The storeId to fetch products for
   */
  public loadProductsForStore(storeId: string): void {
    const productsQuery = query(
      collection(this.db, 'products'),
      where('storeId', '==', storeId)
    );
    from(getDocs(productsQuery)).subscribe({
      next: (snapshot) => {
        const products = snapshot.docs.map(
          (docSnap) =>
            ({
              id: docSnap.id,
              ...(docSnap.data() as any),
            } as Product)
        );
        this.productsSubject.next(products);
      },
      error: (err: any) => {},
      // console.error('Error fetching products for store:', err),
    });
  }

  private fetchProducts(): void {
    // Products are fetched via realtime listeners in doSetupFirestoreListeners
    // console.log('fetchProducts - data loaded via realtime listeners');
  }

  private fetchSales(): void {
    // Sales are fetched via realtime listeners in doSetupFirestoreListeners
    // console.log('fetchSales - data loaded via realtime listeners');
  }

  private fetchExpenses(): void {
    // Expenses are fetched via realtime listeners in doSetupFirestoreListeners
    // console.log('fetchExpenses - data loaded via realtime listeners');
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

    // Check for duplicates (case-insensitive)
    const normalizedName = name.trim().toLowerCase();
    const existing = this.categoriesSubject.value.find(
      (c) => c.name.toLowerCase() === normalizedName
    );

    if (existing) {
      return throwError(() => new Error('Category already exists.'));
    }

    const baseData = {
      name: name.trim(),
      createdAt: new Date(),
      storeId: activeStoreId,
      userId: this.getCurrentUser(),
    };

    this.loadingService.show('Adding category...');
    return from(addDoc(collection(this.db, 'categories'), baseData)).pipe(
      map((docRef) => ({ id: docRef.id, ...baseData } as Category)),
      tap((newCategory) => {
        // Optimistic Update
        const current = this._categories();
        const updated = [...current, newCategory];
        this._categories.set(updated);
        this.categoriesSubject.next(updated);
      }),
      catchError((err) => {
        this.handleFirestoreError(err, 'Error adding category');
        return throwError(() => err);
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  deleteCategory(categoryId: string): Observable<void> {
    this.loadingService.show('Deleting category...');
    return from(deleteDoc(doc(this.db, 'categories', categoryId))).pipe(
      tap(() => {
        // Optimistic Update
        const current = this._categories();
        const updated = current.filter((c) => c.id !== categoryId);
        this._categories.set(updated);
        this.categoriesSubject.next(updated);
      }),
      catchError((err) => {
        this.handleFirestoreError(err, 'Error deleting category');
        return throwError(() => err);
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  addExpense(expense: Omit<Expense, 'id' | 'timestamp'>): Observable<Expense> {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    const firestoreData = this.sanitizeData({
      ...expense,
      timestamp: new Date(),
      storeId: activeStoreId,
      userId: this.getFirestoreUserId(),
    });

    this.loadingService.show('Adding expense...');
    return from(addDoc(collection(this.db, 'expenses'), firestoreData)).pipe(
      map((docRef) => ({ id: docRef.id, ...firestoreData } as Expense)),
      tap({
        next: (newExpense) => {
          this.loggingService.logActivity(
            'create',
            'expense',
            newExpense.id,
            newExpense.productName,
            `$${newExpense.price.toFixed(2)}`
          );
        },
        error: (err) => {
          // console.error('Error adding expense:', err)
        },
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  deleteExpense(expenseId: string): Observable<void> {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    this.loadingService.show('Deleting expense...');
    return from(deleteDoc(doc(this.db, 'expenses', expenseId))).pipe(
      tap({
        next: () => {
          // Note: Activity log entity info must be retrieved BEFORE deletion completes if using local state
          const current = this.expensesSubject.value;
          const exp = current.find((e) => e.id === expenseId);
          if (exp) {
            this.loggingService.logActivity(
              'delete',
              'expense',
              expenseId,
              exp.productName,
              'Expense Deleted'
            );
          }
        },
        error: (err) => {
          // console.error('Error deleting expense:', err)
        },
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  addProduct(product: Omit<Product, 'id' | 'createdAt'>): Observable<Product> {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      return throwError(
        () => new Error('Store selection required for this transaction.')
      );
    }

    this.loadingService.show('Adding product...');
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

        const baseData = this.sanitizeData({
          ...product,
          createdAt: new Date(),
          storeId: activeStoreId,
          userId: this.getFirestoreUserId(),
        });

        return from(addDoc(collection(this.db, 'products'), baseData)).pipe(
          map((docRef) => ({ id: docRef.id, ...baseData } as Product)),
          tap({
            next: (newProduct) => {
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
      }),
      finalize(() => this.loadingService.hide())
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

    this.loadingService.show('Deleting product...');
    return from(deleteDoc(doc(this.db, 'products', productId))).pipe(
      tap({
        next: () => {
          this.loggingService.logActivity(
            'delete',
            'product',
            productId,
            product?.name || 'Product',
            'Deleted'
          );
        },
        error: (err) => {
          this.handleFirestoreError(err, 'Error deleting product');
        },
      }),
      finalize(() => this.loadingService.hide())
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

    this.loadingService.show('Recording sale...');
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

        const isImmediate = deliveryDate ? false : true;

        // Debug: Log the pending status calculation
        // console.log('[recordSale] deliveryDate:', deliveryDate);
        // console.log('[recordSale] isImmediate:', isImmediate);
        // console.log('[recordSale] pending:', !isImmediate);

        const firestoreData = this.sanitizeData({
          productId: product.id,
          productName: product.name,
          category: product.category,
          price: product.price,
          costPrice: product.cost || 0,
          quantitySold,
          total,
          cashReceived,
          change,
          pending: isImmediate ? false : true,
          discount,
          discountType,
          timestamp: new Date(),
          storeId: activeStoreId,
          deliveryDate,
          deliveryNotes,
          customerId,
          orderId,
          userId: this.getFirestoreUserId(),
        });

        return from(addDoc(collection(this.db, 'sales'), firestoreData)).pipe(
          map((docRef) => ({ id: docRef.id, ...firestoreData } as Sale)),
          tap({
            next: (newSale) => {
              // Deduct Credit on Success (Client-side tracking)
              this.storeService.deductTransactionCredit(activeStoreId);

              if (isImmediate) {
                // Process delivery logic (inventory, expenses, etc.) immediately
                this.processSaleDeliveryLogic(newSale);
                this.loggingService.logActivity(
                  'create',
                  'sale',
                  newSale.id,
                  product.name,
                  `Sold ${quantitySold} units (Delivered)`
                );
              } else {
                this.loggingService.logActivity(
                  'create',
                  'sale',
                  newSale.id,
                  product.name,
                  `Sold ${quantitySold} units (Pending Delivery)`
                );
              }
              this.recalculateAndSaveStats();
            },
            error: (err) => {
              this.handleFirestoreError(err, 'Error recording sale');
            },
          })
        );
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  completePendingSale(saleId: string): void {
    const currentSales = this.salesSubject.value;
    const sale = currentSales.find((s) => s.id === saleId);

    if (!sale) {
      console.error('Sale not found via ID');
      return;
    }

    const saleRef = doc(this.db, 'sales', saleId);
    this.loadingService.show('Completing sale...');
    from(updateDoc(saleRef, { pending: false }))
      .pipe(finalize(() => this.loadingService.hide()))
      .subscribe({
        next: () => {
          // Update local state
          const updatedSales = currentSales.map((s) =>
            s.id === saleId ? { ...s, pending: false } : s
          );
          this.salesSubject.next(updatedSales);

          // Process inventory & expense logic
          this.processSaleDeliveryLogic(sale);

          this.loggingService.logActivity(
            'complete',
            'sale',
            saleId,
            sale.productName,
            `Marked as delivered & Deducted ${sale.quantitySold} units`
          );

          this.notificationService.pushNotification(
            'Delivery Confirmed! ✅',
            `The order for ${
              sale.customerName || 'a customer'
            } has been delivered.`,
            NotificationTypes.DELIVERY
          );

          this.recalculateAndSaveStats();
        },
        error: (err: any) => console.error('Error completing sale:', err),
      });
  }

  /**
   * Internal logic to handle deductions and automated expenses when a sale is Delivered
   */
  private processSaleDeliveryLogic(sale: Sale): void {
    const products = this.productsSubject.value;
    const product = products.find((p) => p.id === sale.productId);

    if (!product) return;

    // 1. Deduct the main product itself
    const updatedProduct = {
      ...product,
      quantity: product.quantity - sale.quantitySold,
    };
    this.updateProduct(updatedProduct).subscribe();

    // 2. Process Raw Materials / Recipe to add Expenses
    if (product.recipe && product.recipe.length > 0) {
      const rawMaterials = this.rawMaterials();

      product.recipe.forEach((item) => {
        const totalIngredientQty =
          (Number(item.quantity) || 0) * sale.quantitySold;
        const totalIngredientCost =
          (Number(item.unitCost) || 0) * totalIngredientQty;

        // Check dedicated DB first
        const dedicatedRaw = rawMaterials.find(
          (rm) => rm.id === item.productId
        );
        if (dedicatedRaw) {
          this.addExpense({
            productName: `[Recipe Use] ${dedicatedRaw.name} (for ${product.name})`,
            price: totalIngredientCost,
            notes: `Production: Sold ${sale.quantitySold} units of ${product.name}. Used ${totalIngredientQty} of ${dedicatedRaw.name}.`,
          }).subscribe();
        } else {
          // Fallback: Check standard products list
          const rawProduct = products.find((rp) => rp.id === item.productId);
          if (rawProduct) {
            const updatedRaw = {
              ...rawProduct,
              quantity: rawProduct.quantity - totalIngredientQty,
            };
            this.updateProduct(updatedRaw).subscribe();

            this.addExpense({
              productName: `[Recipe Use] ${rawProduct.name} (for ${product.name})`,
              price: totalIngredientCost,
              notes: `Production: Sold ${sale.quantitySold} units of ${product.name}. Deducted ${totalIngredientQty} from ${rawProduct.name} stock.`,
            }).subscribe();
          }
        }
      });
    } else {
      // 3. FALLBACK: If NO recipe, add a single expense for the product's COGS
      const totalCost = (sale.costPrice || 0) * sale.quantitySold;
      if (totalCost > 0) {
        this.addExpense({
          productName: `[COGS] ${product.name}`,
          price: totalCost,
          notes: `Automated Expense: Cost of goods sold for ${sale.quantitySold} units.`,
        }).subscribe();
      }
    }

    // 4. Award Credits to Customer
    if (sale.customerId) {
      const customer = this.customerService.getCustomerById(sale.customerId);
      if (customer) {
        const creditsEarned = Math.floor(sale.total / 5000);
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
  }

  updateSale(sale: Sale): void {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      console.error('Store selection required to update sale.');
      return;
    }

    const saleRef = doc(this.db, 'sales', sale.id);
    const updateData = this.sanitizeData({ ...sale, storeId: activeStoreId });

    from(setDoc(saleRef, updateData, { merge: true })).subscribe({
      next: () => {
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

    const saleRef = doc(this.db, 'sales', sale.id);
    this.loadingService.show('Confirming reservation...');
    from(updateDoc(saleRef, { reservationStatus: 'confirmed' }))
      .pipe(finalize(() => this.loadingService.hide()))
      .subscribe({
        next: () => {
          // Optimistic update
          const currentSales = this.salesSubject.value;
          const newSales = currentSales.map((s) =>
            s.id === sale.id
              ? { ...s, reservationStatus: 'confirmed' as const }
              : s
          );
          this.salesSubject.next(newSales);

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
    const sale = this._sales().find((s) => s.id === saleId);

    // If the sale was NOT pending, it means stock was already deducted.
    // We should restore the stock upon deletion.
    if (sale && !sale.pending) {
      this.restockProduct(sale.productId, sale.quantitySold);
    }

    this.loadingService.show('Deleting sale...');
    from(deleteDoc(doc(this.db, 'sales', saleId)))
      .pipe(finalize(() => this.loadingService.hide()))
      .subscribe({
        next: () => {
          this.loggingService.logActivity(
            'delete',
            'sale',
            saleId,
            sale?.productName || 'Sale',
            `Deleted sale record ${
              sale && !sale.pending ? '& Restored Stock' : ''
            }`
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

    const firestoreData = this.sanitizeData({
      ...product,
      storeId: activeStoreId,
      userId: this.getFirestoreUserId(),
    });

    this.loadingService.show('Updating product...');
    return from(
      setDoc(doc(this.db, 'products', product.id), firestoreData, {
        merge: true,
      })
    ).pipe(
      map(() => product),
      tap({
        next: () => {
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
            this._sales.set(updatedSales);

            // Update Firestore for each sale (Fire and forget)
            salesToUpdate.forEach((sale) => {
              updateDoc(doc(this.db, 'sales', sale.id), {
                productName: product.name,
              }).catch((err) =>
                console.error(`Error updating sale ${sale.id} name:`, err)
              );
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
        error: (err) => {
          this.handleFirestoreError(err, 'Error updating product');
        },
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  public recalculateAndSaveStats(): void {
    const storeId = this.storeService.getActiveStoreId();
    if (!storeId) return;

    const products = this.productsSubject.value;
    const sales = this.salesSubject.value;

    const totalRevenue = sales.reduce((sum, s) => sum + (s.total || 0), 0);
    const totalProfit = sales.reduce((sum, s) => {
      const cost = (s.costPrice || 0) * (s.quantitySold || 1);
      return sum + ((s.total || 0) - cost);
    }, 0);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const mtdSales = sales.filter((s) => new Date(s.timestamp) >= startOfMonth);
    const mtdRevenue = mtdSales.reduce((sum, s) => sum + (s.total || 0), 0);
    const mtdProfit = mtdSales.reduce((sum, s) => {
      const cost = (s.costPrice || 0) * (s.quantitySold || 1);
      return sum + ((s.total || 0) - cost);
    }, 0);

    const todayStr = now.toISOString().split('T')[0];
    const todaySales = sales.filter(
      (s) => new Date(s.timestamp).toISOString().split('T')[0] === todayStr
    );
    const todayRevenue = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);
    const todayProfit = todaySales.reduce((sum, s) => {
      const cost = (s.costPrice || 0) * (s.quantitySold || 1);
      return sum + ((s.total || 0) - cost);
    }, 0);
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
      totalProfit,
      mtdProfit,
      todayProfit,
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

    // Sanitize data before sending to Firestore (remove undefined fields)
    const sanitizedStats = this.sanitizeData(stats);

    setDoc(doc(this.db, 'stats', storeId), sanitizedStats).catch((err) =>
      console.error('Error updating aggregation document:', err)
    );
  }

  /**
   * Recursively removes undefined values from an object to make it Firestore-compatible.
   * Firestore throws errors if it encounters 'undefined' values.
   */
  private sanitizeData(data: any): any {
    if (data === null || typeof data !== 'object') {
      return data;
    }

    if (data instanceof Date) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((v) => this.sanitizeData(v));
    }

    const result: any = {};
    Object.keys(data).forEach((key) => {
      const value = data[key];
      if (value !== undefined) {
        result[key] = this.sanitizeData(value);
      }
    });

    return result;
  }

  // --- Raw Material CRUD ---

  addRawMaterial(
    raw: Omit<RawMaterial, 'id' | 'createdAt'>
  ): Observable<RawMaterial> {
    const storeId = this.storeService.getActiveStoreId();
    if (!storeId) return throwError(() => new Error('Store ID required.'));

    const baseData = {
      ...raw,
      createdAt: new Date(),
      storeId,
      userId: this.getFirestoreUserId(),
    };

    this.loadingService.show('Adding raw material...');
    return from(addDoc(collection(this.db, 'rawMaterials'), baseData)).pipe(
      map((docRef) => ({ id: docRef.id, ...baseData } as RawMaterial)),
      tap({
        next: (newRaw) => {
          // Optimistic Update
          const current = this._rawMaterials();
          const updated = [...current, newRaw];
          this._rawMaterials.set(updated);
          this.rawMaterialsSubject.next(updated);
          this.recalculateAndSaveStats();
        },
        error: (err) =>
          this.handleFirestoreError(err, 'Error adding raw material'),
      }),
      finalize(() => this.loadingService.hide())
    );
  }

  updateRawMaterial(raw: RawMaterial): Observable<void> {
    this.loadingService.show('Updating raw material...');
    return from(
      updateDoc(doc(this.db, 'rawMaterials', raw.id), {
        name: raw.name,
        cost: raw.cost,
      })
    ).pipe(
      tap(() => {
        // Optimistic Update
        const current = this._rawMaterials();
        const updated = current.map((r) => (r.id === raw.id ? raw : r));
        this._rawMaterials.set(updated);
        this.rawMaterialsSubject.next(updated);
        this.recalculateAndSaveStats();
      }),
      catchError((err) =>
        throwError(() =>
          this.handleFirestoreError(err, 'Error updating raw material')
        )
      ),
      finalize(() => this.loadingService.hide())
    );
  }

  deleteRawMaterial(id: string): Observable<void> {
    this.loadingService.show('Deleting raw material...');
    return from(deleteDoc(doc(this.db, 'rawMaterials', id))).pipe(
      tap(() => {
        // Optimistic Update
        const current = this._rawMaterials();
        const updated = current.filter((r) => r.id !== id);
        this._rawMaterials.set(updated);
        this.rawMaterialsSubject.next(updated);
        this.recalculateAndSaveStats();
      }),
      catchError((err) =>
        throwError(() =>
          this.handleFirestoreError(err, 'Error deleting raw material')
        )
      ),
      finalize(() => this.loadingService.hide())
    );
  }
}
