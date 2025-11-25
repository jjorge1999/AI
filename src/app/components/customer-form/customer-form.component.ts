import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CustomerService } from '../../services/customer.service';
import { Customer } from '../../models/inventory.models';

@Component({
  selector: 'app-customer-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './customer-form.component.html',
  styleUrl: './customer-form.component.css'
})
export class CustomerFormComponent implements OnInit {
  customers: Customer[] = [];
  editingId: string | null = null;
  
  customer = {
    name: '',
    phoneNumber: '',
    deliveryAddress: ''
  };

  constructor(private customerService: CustomerService) {}

  ngOnInit(): void {
    this.customerService.getCustomers().subscribe(customers => {
      this.customers = customers;
    });
  }

  onSubmit(): void {
    if (this.isValid()) {
      if (this.editingId) {
        this.customerService.updateCustomer(this.editingId, {
          name: this.customer.name,
          phoneNumber: this.customer.phoneNumber,
          deliveryAddress: this.customer.deliveryAddress
        });
        this.editingId = null;
      } else {
        this.customerService.addCustomer({
          name: this.customer.name,
          phoneNumber: this.customer.phoneNumber,
          deliveryAddress: this.customer.deliveryAddress
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
      deliveryAddress: cust.deliveryAddress || ''
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
      deliveryAddress: ''
    };
  }

  deleteCustomer(id: string): void {
    if (confirm('Are you sure you want to delete this customer?')) {
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
}
