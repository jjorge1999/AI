import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { Customer } from '../models/inventory.models';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class CustomerService {
  private apiUrl = environment.apiUrl;
  private customersSubject = new BehaviorSubject<Customer[]>([]);
  public customers$ = this.customersSubject.asObservable();

  constructor(private http: HttpClient) {
    this.loadInitialData();
  }

  private loadInitialData(): void {
    this.fetchCustomers();
  }

  private getCurrentUser(): string {
    return localStorage.getItem('jjm_user_id') || 'guest';
  }

  public reloadData(): void {
    this.loadInitialData();
  }

  private fetchCustomers(): void {
    const userId = this.getCurrentUser();
    this.http
      .get<Customer[]>(`${this.apiUrl}/customers?userId=${userId}`)
      .subscribe({
        next: (customers) => this.customersSubject.next(customers),
        error: (err) => console.error('Error fetching customers:', err),
      });
  }

  getCustomers(): Observable<Customer[]> {
    return this.customers$;
  }

  addCustomer(customer: Omit<Customer, 'id' | 'createdAt'>): void {
    const customerWithUser = {
      ...customer,
      userId: this.getCurrentUser(),
    };
    this.http
      .post<Customer>(`${this.apiUrl}/customers`, customerWithUser)
      .subscribe({
        next: (newCustomer) => {
          const current = this.customersSubject.value;
          this.customersSubject.next([...current, newCustomer]);
        },
        error: (err) => console.error('Error adding customer:', err),
      });
  }

  updateCustomer(id: string, updates: Partial<Customer>): void {
    this.http
      .put<Customer>(`${this.apiUrl}/customers/${id}`, updates)
      .subscribe({
        next: () => {
          const current = this.customersSubject.value;
          const updated = current.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          );
          this.customersSubject.next(updated);
        },
        error: (err) => console.error('Error updating customer:', err),
      });
  }

  deleteCustomer(id: string): void {
    this.http.delete(`${this.apiUrl}/customers/${id}`).subscribe({
      next: () => {
        const current = this.customersSubject.value;
        const filtered = current.filter((c) => c.id !== id);
        this.customersSubject.next(filtered);
      },
      error: (err) => console.error('Error deleting customer:', err),
    });
  }

  getCustomerById(id: string): Customer | undefined {
    return this.customersSubject.value.find((c) => c.id === id);
  }
}
