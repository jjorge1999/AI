import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Product, Sale, Expense } from '../models/inventory.models';
import { environment } from '../../environments/environment';
import { LoggingService } from './logging.service';

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

  constructor(
    private http: HttpClient,
    private loggingService: LoggingService
  ) {
    this.loadInitialData();
  }

  private getCurrentUser(): string {
    return localStorage.getItem('jjm_user_id') || 'guest';
  }

  public reloadData(): void {
    this.loadInitialData();
  }

  private loadInitialData(): void {
    this.fetchProducts();
    this.fetchSales();
    this.fetchExpenses();
  }

  private fetchProducts(): void {
    const userId = this.getCurrentUser();
    this.http
      .get<Product[]>(`${this.apiUrl}/products?userId=${userId}`)
      .subscribe({
        next: (products) => this.productsSubject.next(products),
        error: (err) => console.error('Error fetching products:', err),
      });
  }

  private fetchSales(): void {
    const userId = this.getCurrentUser();
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

  addExpense(expense: Omit<Expense, 'id' | 'timestamp'>): void {
    const expenseWithUser = {
      ...expense,
      userId: this.getCurrentUser(),
    };
    this.http
      .post<Expense>(`${this.apiUrl}/expenses`, expenseWithUser)
      .subscribe({
        next: (newExpense) => {
          const current = this.expensesSubject.value;
          this.expensesSubject.next([...current, newExpense]);

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

  addProduct(product: Omit<Product, 'id' | 'createdAt'>): void {
    const productWithUser = {
      ...product,
      userId: this.getCurrentUser(),
    };
    this.http
      .post<Product>(`${this.apiUrl}/products`, productWithUser)
      .subscribe({
        next: (newProduct) => {
          const current = this.productsSubject.value;
          this.productsSubject.next([...current, newProduct]);
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

  recordSale(
    productId: string,
    quantitySold: number,
    cashReceived: number,
    deliveryDate?: Date,
    deliveryNotes?: string,
    customerId?: string,
    discount: number = 0,
    discountType: 'amount' | 'percent' = 'amount'
  ): void {
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

    const saleData = {
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
      userId: this.getCurrentUser(),
    };

    this.http.post<Sale>(`${this.apiUrl}/sales`, saleData).subscribe({
      next: (newSale) => {
        // Update local sales state
        const currentSales = this.salesSubject.value;
        this.salesSubject.next([...currentSales, this.transformSale(newSale)]);

        // Update product quantity via API
        const updatedProduct = {
          ...product,
          quantity: product.quantity - quantitySold,
        };
        this.updateProduct(updatedProduct);

        this.loggingService.logActivity(
          'create',
          'sale',
          newSale.id,
          product.name,
          `Sold ${quantitySold} units`
        );
      },
      error: (err) => console.error('Error recording sale:', err),
    });
  }

  completePendingSale(saleId: string): void {
    this.http
      .put<Sale>(`${this.apiUrl}/sales/${saleId}`, { pending: false })
      .subscribe({
        next: () => {
          const currentSales = this.salesSubject.value;
          const sale = currentSales.find((s) => s.id === saleId);
          const updatedSales = currentSales.map((sale) =>
            sale.id === saleId ? { ...sale, pending: false } : sale
          );
          this.salesSubject.next(updatedSales);

          if (sale) {
            this.loggingService.logActivity(
              'complete',
              'sale',
              saleId,
              sale.productName,
              'Marked as delivered'
            );
          }
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
    if (typeof date === 'string') return new Date(date);
    // Handle Firestore Timestamp or similar objects
    if (typeof date === 'object' && date._seconds !== undefined) {
      return new Date(date._seconds * 1000);
    }
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

  updateProduct(product: Product): void {
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
