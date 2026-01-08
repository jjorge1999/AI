import { Injectable, signal, effect } from '@angular/core';
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
import { LoggingService } from './logging.service';
import { CustomerService } from './customer.service';
import { FirebaseService } from './firebase.service';
import { StoreService } from './store.service';
import { MaintenanceService } from './maintenance.service';
import { NotificationService } from './notification.service';
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
  disableNetwork,
  enableNetwork,
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

  private readonly _stats = signal<DashboardStats | null>(null);
  public readonly stats = this._stats.asReadonly();

  // Track offline queue count for safety and UI warnings
  private readonly _offlineQueueCount = signal<number>(0);
  public readonly offlineQueueCount = this._offlineQueueCount.asReadonly();

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

  // IndexedDB Constants for Offline Queue
  private readonly DB_NAME = 'JJM_Offline_DB';
  private readonly STORE_NAME = 'offline_queue';

  constructor(
    private readonly loggingService: LoggingService,
    private readonly customerService: CustomerService,
    private readonly firebaseService: FirebaseService,
    private readonly storeService: StoreService,
    private readonly maintenanceService: MaintenanceService,
    private readonly notificationService: NotificationService
  ) {
    this.app = this.firebaseService.app;
    this.db = this.firebaseService.db;
    this.auth = getAuth(this.app);
    this.hydrateFromCache();

    // Initial check of offline queue count
    this.updateOfflineQueueCount();

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

  /**
   * Check if Data Saver mode is enabled (offline mode - no network calls)
   */
  public isDataSaverMode(): boolean {
    return localStorage.getItem('jjm_data_saver_mode') === 'true';
  }

  /**
   * Helper to open the IndexedDB for offline storage.
   */
  private getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true,
          });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Updates the signal tracking how many items are in the queue.
   */
  private async updateOfflineQueueCount(): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(this.STORE_NAME, 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.count();

      request.onsuccess = () => {
        this._offlineQueueCount.set(request.result);
      };
    } catch (e) {
      console.warn('Failed to update offline queue count:', e);
    }
  }

  /**
   * Queue a write operation to IndexedDB for later sync when offline.
   */
  private async queueOfflineWrite(
    operation: 'create' | 'update' | 'delete',
    collection: string,
    data: any
  ): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);

      const entry = {
        operation,
        collection,
        data,
        timestamp: new Date().toISOString(),
        storeId: this.storeService.getActiveStoreId(),
      };

      store.add(entry);

      transaction.oncomplete = () => {
        console.log(
          `Queued offline ${operation} for ${collection} in IndexedDB`
        );
        this.updateOfflineQueueCount();
      };
    } catch (e) {
      console.error('Failed to queue offline write to IndexedDB:', e);
    }
  }

  /**
   * Process all queued offline writes from IndexedDB when coming back online.
   */
  public async syncOfflineQueue(): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(this.STORE_NAME, 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.getAll();

      request.onsuccess = async () => {
        const queue = request.result;

        if (queue.length === 0) {
          console.log('No offline writes to sync from IndexedDB.');
          return;
        }

        console.log(`Syncing ${queue.length} offline writes from IndexedDB...`);

        for (const item of queue) {
          try {
            if (item.operation === 'create') {
              await addDoc(collection(this.db, item.collection), item.data);
            } else if (item.operation === 'update') {
              await updateDoc(
                doc(this.db, item.collection, item.data.id),
                item.data
              );
            } else if (item.operation === 'delete') {
              await deleteDoc(doc(this.db, item.collection, item.data.id));
            }
            console.log(`Synced ${item.operation} for ${item.collection}`);
          } catch (e) {
            console.error(`Failed to sync ${item.operation}:`, e);
          }
        }

        // Clear the queue after successful sync items were processed
        this.clearOfflineQueue();
      };
    } catch (e) {
      console.error('Failed to sync offline queue from IndexedDB:', e);
    }
  }

  /**
   * Clears the IndexedDB offline queue.
   */
  private async clearOfflineQueue(): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      store.clear();

      transaction.oncomplete = () => {
        console.log('IndexedDB offline queue cleared.');
        this.updateOfflineQueueCount();
      };
    } catch (e) {
      console.error('Failed to clear IndexedDB offline queue:', e);
    }
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
    if (this.isDataSaverMode()) {
      console.log(
        'InventoryService: enableFullSync blocked because Data Saver Mode is ON.'
      );
      return;
    }
    console.log('Enabling Full Firestore Sync...');
    localStorage.setItem('jjm_force_full_load', 'true');
    this.reloadData();
  }

  public stopRealtimeListeners(): void {
    console.log('InventoryService: Stopping all real-time listeners.');
    this.unsubscribes.forEach((unsub) => unsub());
    this.unsubscribes = [];
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Explicitly disables Firestore network communication.
   */
  public async disableFirestoreNetwork(): Promise<void> {
    console.warn('InventoryService: DISABLING Firestore Network Connection.');
    try {
      await disableNetwork(this.db);
    } catch (e) {
      console.error('Failed to disable Firestore network:', e);
    }
  }

  /**
   * Explicitly enables Firestore network communication.
   */
  public async enableFirestoreNetwork(): Promise<void> {
    // SECURITY: Never enable network if Data Saver mode is explicitly ON
    // unless this is a force-sync operation (handled separately)
    if (this.isDataSaverMode()) {
      console.warn(
        'InventoryService: enableFirestoreNetwork BLOCKED. Data Saver is currently ON.'
      );
      return;
    }

    console.log('InventoryService: ENABLING Firestore Network Connection.');
    try {
      await enableNetwork(this.db);
    } catch (e) {
      console.error('Failed to enable Firestore network:', e);
    }
  }

  /**
   * Clears all in-memory data and stops listeners.
   * Call this on logout to ensure clean state.
   */
  public clearAllData(): void {
    console.log('InventoryService: Clearing all data...');

    // Stop all listeners
    this.stopRealtimeListeners();

    // Reset listener initialization flag
    this.listenersInitialized = false;

    // Clear all signals
    this._products.set([]);
    this._sales.set([]);
    this._expenses.set([]);
    this._categories.set([]);
    this._stats.set({
      totalRevenue: 0,
      mtdRevenue: 0,
      todayRevenue: 0,
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
    this.statsSubject.next(this._stats());

    // Clear Firebase user reference
    this.firebaseUser = null;
  }

  private hydrateFromCache(): void {
    // SECURITY: Only hydrate cache if we have a valid store context
    const storeId = this.storeService.getActiveStoreId();
    if (!storeId) {
      console.log(
        'InventoryService: No store context - skipping cache hydration for security.'
      );
      return;
    }

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
        // Cache is now keyed by storeId for isolation
        const cacheKey = `jjm_${storeId}_${item.key}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          item.signal.set(parsed);
          item.subject.next(parsed);
          console.log(`Hydrated ${item.key} from cache for store ${storeId}`);
        }
      });
    } catch (e) {
      console.warn('InventoryService: Failed to hydrate from cache', e);
    }
  }

  private saveToCache(key: string, data: any): void {
    // SECURITY: Only save cache with store context
    const storeId = this.storeService.getActiveStoreId();
    if (!storeId) return; // Don't cache without store context

    try {
      // Cache is keyed by storeId for isolation
      const cacheKey = `jjm_${storeId}_${key}`;
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (e) {
      console.error(`InventoryService: Failed to save ${key} to cache`, e);
    }
  }

  private handleFirestoreError(err: any, context: string): void {
    console.error(`${context}:`, err);
    if (err.code === 'permission-denied') {
      console.warn(
        `PERMISSIONS ERROR in ${context}: The client is blocked from accessing this data. Please update Firestore Security Rules to allow access.`
      );
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
    // Check if Data Saver mode is enabled - don't start listeners
    const isDataSaverMode =
      localStorage.getItem('jjm_data_saver_mode') === 'true';

    if (isDataSaverMode) {
      console.log(
        'Data Saver Mode is ON - Ensuring network is disabled and using cache.'
      );
      this.stopRealtimeListeners();
      this.disableFirestoreNetwork(); // Force offline
      // Still hydrate from cache so data is available
      this.hydrateFromCache();
      return;
    }

    // Ensure network is enabled before starting listeners
    this.enableFirestoreNetwork().then(() => {
      this.stopRealtimeListeners(); // Cleanup first

      const legacyUserId = this.getCurrentUser();
      if (!legacyUserId || legacyUserId === 'guest') return;

      // 0. Check for cached failure to avoid console noise
      const isAuthDisabled =
        localStorage.getItem('firebase_auth_disabled') === 'true';
      if (isAuthDisabled) {
        console.log(
          'Auth previously failed. Skipping to Public/Fallback Mode.'
        );
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
          } else {
            console.log('No aggregation document found for this store.');
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
              console.log(
                'No cached data found for this store. Enabling Full Sync to fetch raw data...'
              );
              this.enableFullSync();
            } else if (hasCachedProducts || hasCachedSales) {
              console.log('Using cached data for this store. Quota preserved.');
            }
          }
        },
        (err) => this.handleFirestoreError(err, 'Stats Listener Error')
      )
    );
  }

  // Migration methods are deprecated - data is already in Firestore
  private migrateProducts(legacyId: string, firestoreId: string): void {
    console.log(
      'Migration deprecated - data should already exist in Firestore'
    );
  }

  private migrateChat(legacyId: string, firestoreId: string): void {
    console.log(
      'Migration deprecated - data should already exist in Firestore'
    );
  }

  private migrateSales(legacyId: string, firestoreId: string): void {
    console.log(
      'Migration deprecated - data should already exist in Firestore'
    );
  }

  private migrateExpenses(legacyId: string, firestoreId: string): void {
    console.log(
      'Migration deprecated - data should already exist in Firestore'
    );
  }

  public loadProducts(): void {
    // Products are loaded via realtime listeners, no separate fetch needed
    console.log('Products loading handled by realtime listeners');
  }

  /**
   * Load products for a specific user (e.g., for public reservation page)
   * @param userId - The userId to fetch products for (e.g., 'admin-1')
   */
  public loadProductsForUser(userId: string): void {
    const productsQuery = query(
      collection(this.db, 'products'),
      where('userId', '==', userId)
    );
    getDocs(productsQuery)
      .then((snapshot) => {
        const products = snapshot.docs.map(
          (docSnap) =>
            ({
              id: docSnap.id,
              ...(docSnap.data() as any),
            } as Product)
        );
        this.productsSubject.next(products);
      })
      .catch((err: any) =>
        console.error('Error fetching products for user:', err)
      );
  }

  private fetchProducts(): void {
    // Products are fetched via realtime listeners in doSetupFirestoreListeners
    console.log('fetchProducts - data loaded via realtime listeners');
  }

  private fetchSales(): void {
    // Sales are fetched via realtime listeners in doSetupFirestoreListeners
    console.log('fetchSales - data loaded via realtime listeners');
  }

  private fetchExpenses(): void {
    // Expenses are fetched via realtime listeners in doSetupFirestoreListeners
    console.log('fetchExpenses - data loaded via realtime listeners');
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

    // DATA SAVER MODE: Queue write locally
    if (this.isDataSaverMode()) {
      const offlineId = `offline_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const newCategory = { id: offlineId, ...baseData } as Category;

      this.queueOfflineWrite('create', 'categories', baseData);

      const current = this.categoriesSubject.value;
      const updated = [...current, newCategory];
      this._categories.set(updated);
      this.categoriesSubject.next(updated);

      this.loggingService.logActivity(
        'create',
        'category',
        offlineId,
        name,
        '(Queued Offline)'
      );
      return of(newCategory);
    }

    // ONLINE MODE
    return from(addDoc(collection(this.db, 'categories'), baseData)).pipe(
      map((docRef) => ({ id: docRef.id, ...baseData } as Category)),
      tap((newCategory) => {
        const current = this.categoriesSubject.value;
        const updated = [...current, newCategory];
        this._categories.set(updated);
        this.categoriesSubject.next(updated);
      }),
      catchError((err) => {
        this.handleFirestoreError(err, 'Error adding category');
        return throwError(() => err);
      })
    );
  }

  deleteCategory(categoryId: string): Observable<void> {
    // DATA SAVER MODE: Queue delete locally
    if (this.isDataSaverMode()) {
      this.queueOfflineWrite('delete', 'categories', { id: categoryId });

      const current = this.categoriesSubject.value;
      const updated = current.filter((c) => c.id !== categoryId);
      this._categories.set(updated);
      this.categoriesSubject.next(updated);

      this.loggingService.logActivity(
        'delete',
        'category',
        categoryId,
        'Category',
        '(Queued Offline)'
      );
      return of(undefined as void);
    }

    // ONLINE MODE
    return from(deleteDoc(doc(this.db, 'categories', categoryId))).pipe(
      tap(() => {
        const current = this.categoriesSubject.value;
        const updated = current.filter((c) => c.id !== categoryId);
        this._categories.set(updated);
        this.categoriesSubject.next(updated);
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

    const firestoreData = {
      ...expense,
      timestamp: new Date(),
      storeId: activeStoreId,
      userId: this.getFirestoreUserId(),
    };

    // DATA SAVER MODE: Queue write locally
    if (this.isDataSaverMode()) {
      const offlineId = `offline_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const newExpense = { id: offlineId, ...firestoreData } as Expense;

      this.queueOfflineWrite('create', 'expenses', firestoreData);

      const current = this.expensesSubject.value;
      const updated = [...current, newExpense];
      this._expenses.set(updated);
      this.expensesSubject.next(updated);

      this.loggingService.logActivity(
        'create',
        'expense',
        offlineId,
        newExpense.productName,
        '(Queued Offline)'
      );
      return of(newExpense);
    }

    // ONLINE MODE
    return from(addDoc(collection(this.db, 'expenses'), firestoreData)).pipe(
      map((docRef) => ({ id: docRef.id, ...firestoreData } as Expense)),
      tap({
        next: (newExpense) => {
          const current = this.expensesSubject.value;
          if (!current.find((e) => e.id === newExpense.id)) {
            const updated = [...current, newExpense];
            this._expenses.set(updated);
            this.expensesSubject.next(updated);
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

    // DATA SAVER MODE: Queue delete locally
    if (this.isDataSaverMode()) {
      this.queueOfflineWrite('delete', 'expenses', { id: expenseId });

      const current = this.expensesSubject.value;
      const exp = current.find((e) => e.id === expenseId);
      const updated = current.filter((e) => e.id !== expenseId);
      this._expenses.set(updated);
      this.expensesSubject.next(updated);

      if (exp) {
        this.loggingService.logActivity(
          'delete',
          'expense',
          expenseId,
          exp.productName,
          '(Queued Offline)'
        );
      }
      return of(undefined as void);
    }

    // ONLINE MODE
    return from(deleteDoc(doc(this.db, 'expenses', expenseId))).pipe(
      tap({
        next: () => {
          const current = this.expensesSubject.value;
          const exp = current.find((e) => e.id === expenseId);
          const updated = current.filter((e) => e.id !== expenseId);
          this._expenses.set(updated);
          this.expensesSubject.next(updated);

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
          userId: this.getFirestoreUserId(),
        };

        // DATA SAVER MODE: Queue write locally
        if (this.isDataSaverMode()) {
          const offlineId = `offline_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
          const newProduct = { id: offlineId, ...baseData } as Product;

          this.queueOfflineWrite('create', 'products', baseData);

          const current = this.productsSubject.value;
          const updated = [...current, newProduct];
          this._products.set(updated);
          this.productsSubject.next(updated);

          this.loggingService.logActivity(
            'create',
            'product',
            offlineId,
            newProduct.name,
            '(Queued Offline)'
          );
          this.recalculateAndSaveStats();

          return of(newProduct);
        }

        // ONLINE MODE: Normal Firestore write
        return from(addDoc(collection(this.db, 'products'), baseData)).pipe(
          map((docRef) => ({ id: docRef.id, ...baseData } as Product)),
          tap({
            next: (newProduct) => {
              const current = this.productsSubject.value;
              if (!current.find((p) => p.id === newProduct.id)) {
                const updated = [...current, newProduct];
                this._products.set(updated); // Update signal for cache effect
                this.productsSubject.next(updated);
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

    // DATA SAVER MODE: Queue delete locally
    if (this.isDataSaverMode()) {
      this.queueOfflineWrite('delete', 'products', { id: productId });

      const current = this.productsSubject.value;
      const updated = current.filter((p) => p.id !== productId);
      this._products.set(updated);
      this.productsSubject.next(updated);

      this.loggingService.logActivity(
        'delete',
        'product',
        productId,
        product?.name || 'Product',
        '(Queued Offline)'
      );
      return of(undefined as void);
    }

    // ONLINE MODE
    return from(deleteDoc(doc(this.db, 'products', productId))).pipe(
      tap({
        next: () => {
          const current = this.productsSubject.value;
          const updated = current.filter((p) => p.id !== productId);
          this._products.set(updated); // Update signal for cache effect
          this.productsSubject.next(updated);

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

        // DATA SAVER MODE: Queue write locally instead of calling Firestore
        if (this.isDataSaverMode()) {
          const offlineId = `offline_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
          const newSale = { id: offlineId, ...firestoreData } as Sale;

          // Queue for later sync
          this.queueOfflineWrite('create', 'sales', firestoreData);

          // Update local state immediately
          this.storeService.deductTransactionCredit(activeStoreId);
          const currentSales = this.salesSubject.value;
          const updated = [newSale, ...currentSales];
          this._sales.set(updated);
          this.salesSubject.next(updated);

          this.loggingService.logActivity(
            'create',
            'sale',
            offlineId,
            product.name,
            `Sold ${quantitySold} units (Queued Offline)`
          );
          this.recalculateAndSaveStats();

          return of(newSale);
        }

        // ONLINE MODE: Normal Firestore write
        return from(addDoc(collection(this.db, 'sales'), firestoreData)).pipe(
          map((docRef) => ({ id: docRef.id, ...firestoreData } as Sale)),
          tap({
            next: (newSale) => {
              // Deduct Credit on Success (Client-side tracking)
              this.storeService.deductTransactionCredit(activeStoreId);

              // Update local sales state (both signal and subject for cache effect)
              const currentSales = this.salesSubject.value;
              if (!currentSales.find((s) => s.id === newSale.id)) {
                const updated = [newSale, ...currentSales];
                this._sales.set(updated); // Update signal for cache effect
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
            error: (err) => {
              this.handleFirestoreError(err, 'Error recording sale');
            },
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

    // Helper function for local state update
    const updateLocalState = () => {
      const updatedSales = currentSales.map((s) =>
        s.id === saleId ? { ...s, pending: false } : s
      );
      this._sales.set(updatedSales);
      this.salesSubject.next(updatedSales);

      // Deduct Inventory locally
      const products = this.productsSubject.value;
      const product = products.find((p) => p.id === sale.productId);
      if (product) {
        const updatedProducts = products.map((p) =>
          p.id === sale.productId
            ? { ...p, quantity: p.quantity - sale.quantitySold }
            : p
        );
        this._products.set(updatedProducts);
        this.productsSubject.next(updatedProducts);
      }

      this.loggingService.logActivity(
        'complete',
        'sale',
        saleId,
        sale.productName,
        `Marked as delivered & Deducted ${sale.quantitySold} units`
      );
      this.recalculateAndSaveStats();
    };

    // DATA SAVER MODE: Queue update locally
    if (this.isDataSaverMode()) {
      this.queueOfflineWrite('update', 'sales', { id: saleId, pending: false });

      // Also queue product update
      const product = this.productsSubject.value.find(
        (p) => p.id === sale.productId
      );
      if (product) {
        this.queueOfflineWrite('update', 'products', {
          id: sale.productId,
          quantity: product.quantity - sale.quantitySold,
        });
      }

      updateLocalState();
      this.notificationService.pushNotification(
        'Delivery Confirmed! ✅ (Offline)',
        `The order for ${
          sale.customerName || 'a customer'
        } has been delivered.`,
        'delivery'
      );
      return;
    }

    // ONLINE MODE
    const saleRef = doc(this.db, 'sales', saleId);
    updateDoc(saleRef, { pending: false })
      .then(() => {
        // Update local state (both signal and subject for cache effect)
        const updatedSales = currentSales.map((s) =>
          s.id === saleId ? { ...s, pending: false } : s
        );
        this._sales.set(updatedSales); // Update signal for cache effect
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

        this.notificationService.pushNotification(
          'Delivery Confirmed! ✅',
          `The order for ${
            sale.customerName || 'a customer'
          } has been delivered.`,
          'delivery'
        );

        this.recalculateAndSaveStats();
      })
      .catch((err) => console.error('Error completing sale:', err));
  }

  updateSale(sale: Sale): void {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      console.error('Store selection required to update sale.');
      return;
    }

    const updateData = { ...sale, storeId: activeStoreId };

    // DATA SAVER MODE: Queue update locally
    if (this.isDataSaverMode()) {
      this.queueOfflineWrite('update', 'sales', updateData);

      const currentSales = this.salesSubject.value;
      const updatedSales = currentSales.map((s) =>
        s.id === sale.id
          ? { ...this.transformSale(updateData), id: sale.id }
          : s
      );
      this._sales.set(updatedSales);
      this.salesSubject.next(updatedSales);

      this.loggingService.logActivity(
        'update',
        'sale',
        sale.id,
        sale.productName,
        '(Queued Offline)'
      );
      return;
    }

    // ONLINE MODE
    const saleRef = doc(this.db, 'sales', sale.id);
    setDoc(saleRef, updateData, { merge: true })
      .then(() => {
        // Optimistic update (both signal and subject for cache effect)
        const currentSales = this.salesSubject.value;
        const updatedSales = currentSales.map((s) =>
          s.id === sale.id
            ? { ...this.transformSale(updateData), id: sale.id }
            : s
        );
        this._sales.set(updatedSales); // Update signal for cache effect
        this.salesSubject.next(updatedSales);

        this.loggingService.logActivity(
          'update',
          'sale',
          sale.id,
          sale.productName,
          'Updated delivery details'
        );
      })
      .catch((err) => console.error('Error updating sale:', err));
  }

  confirmReservation(sale: Sale): void {
    const products = this.productsSubject.value;
    const product = products.find((p) => p.id === sale.productId);

    if (!product) {
      console.error('Product not found for confirmation stock deduction');
      return;
    }

    // DATA SAVER MODE: Queue update locally
    if (this.isDataSaverMode()) {
      this.queueOfflineWrite('update', 'sales', {
        id: sale.id,
        reservationStatus: 'confirmed',
      });

      const currentSales = this.salesSubject.value;
      const newSales = currentSales.map((s) =>
        s.id === sale.id ? { ...s, reservationStatus: 'confirmed' as const } : s
      );
      this._sales.set(newSales);
      this.salesSubject.next(newSales);

      this.loggingService.logActivity(
        'update',
        'sale',
        sale.id,
        sale.productName,
        'Confirmed reservation (Queued Offline)'
      );
      return;
    }

    // ONLINE MODE
    const saleRef = doc(this.db, 'sales', sale.id);
    updateDoc(saleRef, { reservationStatus: 'confirmed' })
      .then(() => {
        // Optimistic update (both signal and subject for cache effect)
        const currentSales = this.salesSubject.value;
        const newSales = currentSales.map((s) =>
          s.id === sale.id
            ? { ...s, reservationStatus: 'confirmed' as const }
            : s
        );
        this._sales.set(newSales); // Update signal for cache effect
        this.salesSubject.next(newSales);

        this.loggingService.logActivity(
          'update',
          'sale',
          sale.id,
          sale.productName,
          'Confirmed reservation (Stock deduction pending delivery)'
        );
      })
      .catch((err) => console.error('Error confirming reservation:', err));
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
    // DATA SAVER MODE: Queue delete locally
    if (this.isDataSaverMode()) {
      this.queueOfflineWrite('delete', 'sales', { id: saleId });

      const currentSales = this.salesSubject.value;
      const updatedSales = currentSales.filter((s) => s.id !== saleId);
      this._sales.set(updatedSales);
      this.salesSubject.next(updatedSales);

      this.loggingService.logActivity(
        'delete',
        'sale',
        saleId,
        'Sale',
        '(Queued Offline)'
      );
      this.recalculateAndSaveStats();
      return;
    }

    // ONLINE MODE
    deleteDoc(doc(this.db, 'sales', saleId))
      .then(() => {
        // Optimistic update
        const currentSales = this.salesSubject.value; // Use behavior subject value
        const updatedSales = currentSales.filter((s) => s.id !== saleId);
        this.salesSubject.next(updatedSales);
        // Also update signal if needed, but subscribing to subject usually syncs signal in effects
        this._sales.set(updatedSales);

        this.loggingService.logActivity(
          'delete',
          'sale',
          saleId,
          'Reservation/Sale',
          'Deleted sale record'
        );
        this.recalculateAndSaveStats();
      })
      .catch((err) => console.error('Error deleting sale:', err));
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

    // Helper for local state update
    const updateLocalProductState = () => {
      const currentProducts = this.productsSubject.value;
      const updatedProducts = currentProducts.map((p) =>
        p.id === product.id ? product : p
      );
      this._products.set(updatedProducts);
      this.productsSubject.next(updatedProducts);

      // Update related sales locally
      const currentSales = this.salesSubject.value;
      const salesToUpdate = currentSales.filter(
        (s) => s.productId === product.id && s.productName !== product.name
      );
      if (salesToUpdate.length > 0) {
        const updatedSales = currentSales.map((s) =>
          s.productId === product.id ? { ...s, productName: product.name } : s
        );
        this._sales.set(updatedSales);
        this.salesSubject.next(updatedSales);
      }
    };

    // DATA SAVER MODE: Queue update locally
    if (this.isDataSaverMode()) {
      this.queueOfflineWrite('update', 'products', firestoreData);
      updateLocalProductState();
      this.loggingService.logActivity(
        'update',
        'product',
        product.id,
        product.name,
        '(Queued Offline)'
      );
      this.recalculateAndSaveStats();
      return of(product);
    }

    // ONLINE MODE
    return from(
      setDoc(doc(this.db, 'products', product.id), firestoreData, {
        merge: true,
      })
    ).pipe(
      map(() => product),
      tap({
        next: () => {
          // Update products local state
          const currentProducts = this.productsSubject.value; // Use behavior subject
          const updatedProducts = currentProducts.map((p) =>
            p.id === product.id ? product : p
          );
          this.productsSubject.next(updatedProducts);
          this._products.set(updatedProducts);

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

    // Update local signals and subjects
    this._stats.set(stats);
    this.statsSubject.next(stats);

    // DATA SAVER MODE: Don't write back aggregations to Firestore to save quota
    if (this.isDataSaverMode()) {
      console.log('Data Saver Mode: Skipping stats Firestore update');
      return;
    }

    // ONLINE MODE: Update Firestore for other users to see fresh stats
    setDoc(doc(this.db, 'stats', storeId), stats).catch((err) =>
      console.error('Error updating aggregation document:', err)
    );
  }
}
