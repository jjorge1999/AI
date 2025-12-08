import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { Expense } from '../../models/inventory.models';

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './expenses.component.html',
  styleUrl: './expenses.component.css',
})
export class ExpensesComponent implements OnInit {
  expenses: Expense[] = [];

  // Form fields
  productName = '';
  price: number | null = null;
  notes = '';

  // Pagination
  currentPage = 1;
  pageSize = 10;
  pageSizeOptions = [5, 10, 20, 50];

  constructor(private inventoryService: InventoryService) {}

  ngOnInit(): void {
    this.inventoryService.getExpenses().subscribe((expenses) => {
      this.expenses = expenses;
    });
  }

  get totalExpenses(): number {
    return this.expenses.reduce((sum, e) => sum + e.price, 0);
  }

  // Pagination Getters & Methods
  get paginatedExpenses(): Expense[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    return this.expenses.slice(startIndex, startIndex + this.pageSize);
  }

  get totalPages(): number {
    return Math.ceil(this.expenses.length / this.pageSize);
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

  addExpense(): void {
    if (this.productName && this.price && this.price > 0) {
      this.inventoryService.addExpense({
        productName: this.productName,
        price: this.price,
        notes: this.notes,
      });

      // Reset form
      this.productName = '';
      this.price = null;
      this.notes = '';
    }
  }
}
