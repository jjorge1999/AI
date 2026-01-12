import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import {
  Firestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { FirebaseService } from './firebase.service';
import { SaleEvent } from '../models/sale.model';
import { StoreService } from './store.service';

@Injectable({
  providedIn: 'root',
})
export class SaleService {
  private readonly db: Firestore;
  private readonly salesSubject = new BehaviorSubject<SaleEvent[]>([]);
  public sales$ = this.salesSubject.asObservable();
  private unsubscribe: Unsubscribe | null = null;

  // Default sales to seed if none exist
  private readonly defaultSales: Omit<SaleEvent, 'id'>[] = [
    {
      name: 'New Year Sale',
      month: 1,
      day: 1,
      duration: 7,
      discount: 40,
      isActive: true,
      bannerTitle: '🎊 New Year Sale!',
      bannerMessage: 'Start the year with amazing deals!',
      bannerIcon: '🎆',
    },
    {
      name: "Valentine's Special",
      month: 2,
      day: 14,
      duration: 3,
      discount: 25,
      isActive: true,
      bannerTitle: "💕 Valentine's Special!",
      bannerMessage: 'Share the love with special discounts!',
      bannerIcon: '💝',
    },
    {
      name: 'Summer Sale',
      month: 4,
      day: 15,
      duration: 14,
      discount: 30,
      isActive: true,
      bannerTitle: '☀️ Summer Sale!',
      bannerMessage: 'Hot deals for the summer season!',
      bannerIcon: '🌴',
    },
    {
      name: 'Mid-Year Blowout',
      month: 6,
      day: 15,
      duration: 7,
      discount: 35,
      isActive: true,
      bannerTitle: '🔥 Mid-Year Blowout!',
      bannerMessage: 'Massive savings on selected items!',
      bannerIcon: '💥',
    },
    {
      name: 'Back to School Sale',
      month: 8,
      day: 1,
      duration: 14,
      discount: 20,
      isActive: true,
      bannerTitle: '📚 Back to School Sale!',
      bannerMessage: 'Get ready for school with great discounts!',
      bannerIcon: '🎒',
    },
    {
      name: 'Holiday Season Sale',
      month: 11,
      day: 15,
      duration: 45,
      discount: 50,
      isActive: true,
      bannerTitle: '🎁 Christmas Sale!',
      bannerMessage: 'Celebrate Christmas with 15-70% OFF on selected items!',
      bannerIcon: '🎄',
      holidayKeywords: [
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
      ],
      excludeKeywords: [
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
      ],
    },
    {
      name: 'Christmas Special',
      month: 12,
      day: 20,
      duration: 12,
      discount: 50,
      isActive: true,
      bannerTitle: '🎁 Christmas Special!',
      bannerMessage: 'Last chance for holiday savings!',
      bannerIcon: '🎄',
    },
    {
      name: 'Year-End Clearance',
      month: 12,
      day: 26,
      duration: 6,
      discount: 45,
      isActive: true,
      bannerTitle: '🎊 Year-End Clearance!',
      bannerMessage: 'Clear out the year with massive discounts!',
      bannerIcon: '🎉',
    },
  ];

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly storeService: StoreService
  ) {
    this.db = this.firebaseService.db;

    // Auto-refresh when store changes
    this.storeService.activeStoreId$.subscribe(() => {
      this.stopListening();
      this.startListening();
    });
  }

  /**
   * Start listening to sales from Firestore
   */
  startListening(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) {
      this.salesSubject.next([]);
      return;
    }

    // Only listen to sales for the selected store
    const salesQuery = query(
      collection(this.db, 'sales_events'),
      where('storeId', '==', activeStoreId),
      orderBy('month', 'asc')
    );

    this.unsubscribe = onSnapshot(
      salesQuery,
      (snapshot) => {
        const sales = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as SaleEvent[];

        this.salesSubject.next(sales);

        // Seed default sales if none exist
        if (sales.length === 0) {
          // console.log('No sales found, seeding defaults...');
          this.seedDefaultSales();
        }
      },
      (err) => {
        console.error('Error listening to sales:', err);
        // Fallback to default sales if permission denied or other error
        if (this.salesSubject.value.length === 0) {
          // console.warn('Falling back to default sales data due to error');
          this.salesSubject.next(this.defaultSales as SaleEvent[]);
        }
      }
    );
  }

  /**
   * Stop listening to Firestore
   */
  stopListening(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Get all sales
   */
  getSales(): Observable<SaleEvent[]> {
    return this.sales$;
  }

  getCurrentSalesValue(): SaleEvent[] {
    return this.salesSubject.value;
  }

  /**
   * Get currently active sale based on date
   */
  getCurrentSale(): SaleEvent | null {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const sales = this.salesSubject.value;

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
        return { ...sale, endDate: eventEnd } as SaleEvent & { endDate: Date };
      }
    }

    return null;
  }

  /**
   * Add a new sale
   */
  addSale(sale: Omit<SaleEvent, 'id'>): Observable<string> {
    const saleData = {
      ...sale,
      createdAt: new Date(),
      updatedAt: new Date(),
      storeId: this.storeService.getActiveStoreId() || undefined,
    };

    return from(addDoc(collection(this.db, 'sales_events'), saleData)).pipe(
      map((docRef) => docRef.id),
      tap((id) => {}), // console.log('Sale added with ID:', id)),
      catchError((err) => {
        console.error('Error adding sale:', err);
        throw err;
      })
    );
  }

  /**
   * Update an existing sale
   */
  updateSale(id: string, updates: Partial<SaleEvent>): Observable<void> {
    const updateData = {
      ...updates,
      updatedAt: new Date(),
    };

    return from(updateDoc(doc(this.db, 'sales_events', id), updateData)).pipe(
      tap(() => {}), // console.log('Sale updated:', id)),
      catchError((err) => {
        console.error('Error updating sale:', err);
        throw err;
      })
    );
  }

  /**
   * Delete a sale
   */
  deleteSale(id: string): Observable<void> {
    return from(deleteDoc(doc(this.db, 'sales_events', id))).pipe(
      tap(() => {}), // console.log('Sale deleted:', id)),
      catchError((err) => {
        console.error('Error deleting sale:', err);
        throw err;
      })
    );
  }

  /**
   * Toggle sale active status
   */
  toggleSaleActive(id: string, isActive: boolean): Observable<void> {
    return this.updateSale(id, { isActive });
  }

  /**
   * Seed default sales to Firestore
   */
  private async seedDefaultSales(): Promise<void> {
    const activeStoreId = this.storeService.getActiveStoreId();
    if (!activeStoreId) return; // Only seed if in a store context

    for (const sale of this.defaultSales) {
      try {
        await addDoc(collection(this.db, 'sales_events'), {
          ...sale,
          storeId: activeStoreId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        // console.log('Seeded sale:', sale.name);
      } catch (err) {
        console.error('Error seeding sale:', sale.name, err);
      }
    }
  }
}
