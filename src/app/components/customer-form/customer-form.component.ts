import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CustomerService } from '../../services/customer.service';
import { InventoryService } from '../../services/inventory.service';
import { DialogService } from '../../services/dialog.service';
import { Customer, Sale } from '../../models/inventory.models';

interface CustomerStats {
  totalSpent: number;
  orderCount: number;
  lastOrderDate: Date | null;
}

@Component({
  selector: 'app-customer-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './customer-form.component.html',
  styleUrl: './customer-form.component.css',
})
export class CustomerFormComponent implements OnInit, OnDestroy {
  customers: Customer[] = [];
  sales: Sale[] = [];
  editingId: string | null = null;

  // Search and filtering
  searchQuery = '';
  statusFilter = '';

  // Modal state
  showAddModal = false;
  showProfileModal = false;
  selectedCustomer: Customer | null = null;

  // Pagination
  currentPage = 1;
  pageSize = 10;
  pageSizeOptions = [5, 10, 20, 50];

  // Form
  customer = {
    name: '',
    phoneNumber: '',
    deliveryAddress: '',
  };

  private subscriptions: Subscription[] = [];

  constructor(
    private customerService: CustomerService,
    private inventoryService: InventoryService,
    private dialogService: DialogService
  ) {}

  ngOnInit(): void {
    this.customerService.loadCustomers();

    this.subscriptions.push(
      this.customerService.getCustomers().subscribe((customers) => {
        this.customers = customers;
      })
    );

    this.subscriptions.push(
      this.inventoryService.getSales().subscribe((sales) => {
        this.sales = sales;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  // Filtering
  get filteredCustomers(): Customer[] {
    let result = [...this.customers];

    // Search filter
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.phoneNumber?.toLowerCase().includes(query) ||
          c.id.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (this.statusFilter) {
      result = result.filter(
        (c) => this.getCustomerStatus(c) === this.statusFilter
      );
    }

    return result;
  }

  get paginatedCustomers(): Customer[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    return this.filteredCustomers.slice(startIndex, startIndex + this.pageSize);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredCustomers.length / this.pageSize) || 1;
  }

  // Customer stats
  getCustomerStats(customer: Customer): CustomerStats {
    const customerSales = this.sales.filter(
      (s) => s.customerId === customer.id && !s.pending
    );

    const totalSpent = customerSales.reduce((sum, s) => sum + s.total, 0);
    const orderCount = customerSales.length;
    const lastOrder = customerSales.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0];

    return {
      totalSpent,
      orderCount,
      lastOrderDate: lastOrder ? new Date(lastOrder.timestamp) : null,
    };
  }

  getCustomerStatus(customer: Customer): 'active' | 'lead' | 'inactive' {
    const stats = this.getCustomerStats(customer);
    if (stats.orderCount === 0) return 'lead';
    if (stats.lastOrderDate) {
      const daysSinceLastOrder =
        (Date.now() - stats.lastOrderDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastOrder > 90) return 'inactive';
    }
    return 'active';
  }

  getCustomerInitials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  getAvatarColor(name: string): string {
    const colors = [
      'bg-indigo-500',
      'bg-orange-500',
      'bg-pink-500',
      'bg-emerald-500',
      'bg-purple-500',
      'bg-cyan-500',
      'bg-rose-500',
      'bg-amber-500',
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  }

  getLastActive(customer: Customer): string {
    const stats = this.getCustomerStats(customer);
    if (!stats.lastOrderDate) return 'No orders yet';

    const now = Date.now();
    const diff = now - stats.lastOrderDate.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hours ago`;
    if (days < 30) return `${days} days ago`;
    return stats.lastOrderDate.toLocaleDateString();
  }

  // Modal controls
  openAddModal(): void {
    this.editingId = null;
    this.resetForm();
    this.showAddModal = true;
  }

  openEditModal(customer: Customer): void {
    this.editingId = customer.id;
    this.customer = {
      name: customer.name,
      phoneNumber: customer.phoneNumber || '',
      deliveryAddress: customer.deliveryAddress || '',
    };
    this.showAddModal = true;
  }

  closeAddModal(): void {
    this.showAddModal = false;
    this.editingId = null;
    this.resetForm();
  }

  openProfileModal(customer: Customer): void {
    this.selectedCustomer = customer;
    this.showProfileModal = true;
  }

  closeProfileModal(): void {
    this.showProfileModal = false;
    this.selectedCustomer = null;
  }

  // Form actions
  onSubmit(): void {
    if (this.isValid()) {
      if (this.editingId) {
        this.customerService
          .updateCustomer(this.editingId, {
            name: this.customer.name,
            phoneNumber: this.customer.phoneNumber,
            deliveryAddress: this.customer.deliveryAddress,
          })
          .subscribe(() => {
            this.closeAddModal();
          });
      } else {
        // Check for duplicates
        const normalizedName = this.customer.name.trim().toLowerCase();
        const existingCustomer = this.customers.find(
          (c) => c.name.trim().toLowerCase() === normalizedName
        );

        if (existingCustomer) {
          this.dialogService
            .warning('A customer with this name already exists.')
            .subscribe();
          return;
        }

        this.customerService
          .addCustomer({
            name: this.customer.name,
            phoneNumber: this.customer.phoneNumber,
            deliveryAddress: this.customer.deliveryAddress,
          })
          .subscribe(() => {
            this.closeAddModal();
          });
      }
    }
  }

  editCustomer(cust: Customer): void {
    this.openEditModal(cust);
  }

  cancelEdit(): void {
    this.closeAddModal();
  }

  resetForm(): void {
    this.customer = {
      name: '',
      phoneNumber: '',
      deliveryAddress: '',
    };
  }

  deleteCustomer(id: string): void {
    this.dialogService
      .confirm(
        'Are you sure you want to delete this customer?',
        'Delete Customer'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.customerService.deleteCustomer(id).subscribe(() => {
            if (this.editingId === id) {
              this.cancelEdit();
            }
            if (this.selectedCustomer?.id === id) {
              this.closeProfileModal();
            }
          });
        }
      });
  }

  isValid(): boolean {
    return !!(
      this.customer.name &&
      this.customer.phoneNumber &&
      this.customer.deliveryAddress
    );
  }

  // Pagination
  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  prevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  goToPage(page: number): void {
    this.currentPage = page;
  }

  getPageNumbers(): number[] {
    return Array(this.totalPages)
      .fill(0)
      .map((x, i) => i + 1);
  }

  onSearchChange(): void {
    this.currentPage = 1;
  }

  onFilterChange(): void {
    this.currentPage = 1;
  }

  // Helpers
  get showingFrom(): number {
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get showingTo(): number {
    return Math.min(
      this.currentPage * this.pageSize,
      this.filteredCustomers.length
    );
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }

  // Get recent orders for a customer
  getCustomerOrders(customer: Customer): Sale[] {
    return this.sales
      .filter((s) => s.customerId === customer.id)
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, 5);
  }
}
