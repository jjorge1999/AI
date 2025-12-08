import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CustomerService } from '../../services/customer.service';
import { DialogService } from '../../services/dialog.service';
import { Customer } from '../../models/inventory.models';

@Component({
  selector: 'app-customer-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './customer-form.component.html',
  styleUrl: './customer-form.component.css',
})
export class CustomerFormComponent implements OnInit {
  customers: Customer[] = [];
  editingId: string | null = null;

  // Pagination
  currentPage = 1;
  pageSize = 10;
  pageSizeOptions = [5, 10, 20, 50];

  customer = {
    name: '',
    phoneNumber: '',
    deliveryAddress: '',
  };

  constructor(
    private customerService: CustomerService,
    private dialogService: DialogService
  ) {}

  ngOnInit(): void {
    this.customerService.getCustomers().subscribe((customers) => {
      this.customers = customers;
    });
  }

  onSubmit(): void {
    if (this.isValid()) {
      if (this.editingId) {
        this.customerService.updateCustomer(this.editingId, {
          name: this.customer.name,
          phoneNumber: this.customer.phoneNumber,
          deliveryAddress: this.customer.deliveryAddress,
        });
        this.editingId = null;
      } else {
        this.customerService.addCustomer({
          name: this.customer.name,
          phoneNumber: this.customer.phoneNumber,
          deliveryAddress: this.customer.deliveryAddress,
        });
      }

      // Reset form
      this.resetForm();
    }
  }

  editCustomer(cust: Customer): void {
    this.editingId = cust.id;
    this.customer = {
      name: cust.name,
      phoneNumber: cust.phoneNumber || '',
      deliveryAddress: cust.deliveryAddress || '',
    };
  }

  cancelEdit(): void {
    this.editingId = null;
    this.resetForm();
  }

  resetForm(): void {
    this.customer = {
      name: '',
      phoneNumber: '',
      deliveryAddress: '',
    };
  }

  async deleteCustomer(id: string): Promise<void> {
    if (
      await this.dialogService.confirm(
        'Are you sure you want to delete this customer?',
        'Delete Customer'
      )
    ) {
      this.customerService.deleteCustomer(id);
      if (this.editingId === id) {
        this.cancelEdit();
      }
    }
  }

  isValid(): boolean {
    return !!(
      this.customer.name &&
      this.customer.phoneNumber &&
      this.customer.deliveryAddress
    );
  }

  get paginatedCustomers(): Customer[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    return this.customers.slice(startIndex, startIndex + this.pageSize);
  }

  get totalPages(): number {
    return Math.ceil(this.customers.length / this.pageSize);
  }

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
}
