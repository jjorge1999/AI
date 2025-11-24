import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Customer } from '../models/inventory.models';

@Injectable({
  providedIn: 'root'
})
export class CustomerService {
  private readonly STORAGE_KEY = 'jjm_customers';
  private customersSubject = new BehaviorSubject<Customer[]>([]);
  public customers$ = this.customersSubject.asObservable();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        const customers = JSON.parse(data);
        this.customersSubject.next(customers);
      }
    } catch (error) {
      console.error('Error loading customers from localStorage:', error);
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(
        this.STORAGE_KEY,
        JSON.stringify(this.customersSubject.value)
      );
    } catch (error) {
      console.error('Error saving customers to localStorage:', error);
    }
  }

  getCustomers(): Observable<Customer[]> {
    return this.customers$;
  }

  addCustomer(customer: Omit<Customer, 'id' | 'createdAt'>): void {
    const newCustomer: Customer = {
      ...customer,
      id: this.generateId(),
      createdAt: new Date()
    };

    const currentCustomers = this.customersSubject.value;
    this.customersSubject.next([...currentCustomers, newCustomer]);
    this.saveToStorage();
  }

  updateCustomer(id: string, updates: Partial<Customer>): void {
    const customers = this.customersSubject.value;
    const updatedCustomers = customers.map(c =>
      c.id === id ? { ...c, ...updates } : c
    );
    this.customersSubject.next(updatedCustomers);
    this.saveToStorage();
  }

  deleteCustomer(id: string): void {
    const customers = this.customersSubject.value;
    const filteredCustomers = customers.filter(c => c.id !== id);
    this.customersSubject.next(filteredCustomers);
    this.saveToStorage();
  }

  getCustomerById(id: string): Customer | undefined {
    return this.customersSubject.value.find(c => c.id === id);
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
