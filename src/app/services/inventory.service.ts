import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Product, Sale, Expense } from '../models/inventory.models';

@Injectable({
  providedIn: 'root'
})
export class InventoryService {
  private readonly STORAGE_KEY_PRODUCTS = 'jjm_products';
  private readonly STORAGE_KEY_SALES = 'jjm_sales';
  private readonly STORAGE_KEY_EXPENSES = 'jjm_expenses';

  private productsSubject = new BehaviorSubject<Product[]>([]);
  private salesSubject = new BehaviorSubject<Sale[]>([]);
  private expensesSubject = new BehaviorSubject<Expense[]>([]);

  public products$ = this.productsSubject.asObservable();
  public sales$ = this.salesSubject.asObservable();
  public expenses$ = this.expensesSubject.asObservable();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const productsData = localStorage.getItem(this.STORAGE_KEY_PRODUCTS);
      const salesData = localStorage.getItem(this.STORAGE_KEY_SALES);

      if (productsData) {
        const products = JSON.parse(productsData);
        this.productsSubject.next(products);
      }

      if (salesData) {
        const sales = JSON.parse(salesData);
        this.salesSubject.next(sales);
      }

      const expensesData = localStorage.getItem(this.STORAGE_KEY_EXPENSES);
      if (expensesData) {
        const expenses = JSON.parse(expensesData);
        this.expensesSubject.next(expenses);
      }
    } catch (error) {
      console.error('Error loading from localStorage:', error);
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(
        this.STORAGE_KEY_PRODUCTS,
        JSON.stringify(this.productsSubject.value)
      );
      localStorage.setItem(
        this.STORAGE_KEY_SALES,
        JSON.stringify(this.salesSubject.value)
      );
      localStorage.setItem(
        this.STORAGE_KEY_EXPENSES,
        JSON.stringify(this.expensesSubject.value)
      );
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
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
    const newExpense: Expense = {
      ...expense,
      id: this.generateId(),
      timestamp: new Date()
    };
    this.expensesSubject.next([...this.expensesSubject.value, newExpense]);
    this.saveToStorage();
  }

  addProduct(product: Omit<Product, 'id' | 'createdAt'>): void {
    const newProduct: Product = {
      ...product,
      id: this.generateId(),
      createdAt: new Date()
    };

    const currentProducts = this.productsSubject.value;
    this.productsSubject.next([...currentProducts, newProduct]);
    this.saveToStorage();
  }

  recordSale(productId: string, quantitySold: number, cashReceived: number, deliveryDate?: Date, deliveryNotes?: string): void {
    const products = this.productsSubject.value;
    const product = products.find(p => p.id === productId);

    if (!product) {
      throw new Error('Product not found');
    }

    if (product.quantity < quantitySold) {
      throw new Error('Insufficient quantity');
    }

    const total = product.price * quantitySold;
    const change = cashReceived - total;

    if (change < 0) {
      throw new Error('Insufficient cash');
    }

    // Create sale record with pending flag
    const sale: Sale = {
      id: this.generateId(),
      productId: product.id,
      productName: product.name,
      category: product.category,
      price: product.price,
      quantitySold,
      total,
      cashReceived,
      change,
      timestamp: new Date(),
      deliveryDate,
      deliveryNotes,
      pending: true // mark as pending delivery
    };

    // Update product quantity
    const updatedProducts = products.map(p =>
      p.id === productId
        ? { ...p, quantity: p.quantity - quantitySold }
        : p
    );

    this.productsSubject.next(updatedProducts);
    this.salesSubject.next([...this.salesSubject.value, sale]);
    this.saveToStorage();
  }

  completePendingSale(saleId: string): void {
    const currentSales = this.salesSubject.value;
    const updatedSales = currentSales.map(sale => 
      sale.id === saleId ? { ...sale, pending: false } : sale
    );
    this.salesSubject.next(updatedSales);
    this.saveToStorage();
  }

  restockProduct(productId: string, quantityToAdd: number): void {
    const products = this.productsSubject.value;
    const updatedProducts = products.map(p =>
      p.id === productId
        ? { ...p, quantity: p.quantity + quantityToAdd }
        : p
    );
    this.productsSubject.next(updatedProducts);
    this.saveToStorage();
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  clearAllData(): void {
    this.productsSubject.next([]);
    this.salesSubject.next([]);
    localStorage.removeItem(this.STORAGE_KEY_PRODUCTS);
    localStorage.removeItem(this.STORAGE_KEY_SALES);
  }
}
