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
  styleUrl: './expenses.component.css'
})
export class ExpensesComponent implements OnInit {
  expenses: Expense[] = [];
  
  // Form fields
  productName = '';
  price: number | null = null;
  notes = '';
  
  constructor(private inventoryService: InventoryService) {}

  ngOnInit(): void {
    this.inventoryService.getExpenses().subscribe(expenses => {
      this.expenses = expenses;
    });
  }

  get totalExpenses(): number {
    return this.expenses.reduce((sum, e) => sum + e.price, 0);
  }

  addExpense(): void {
    if (this.productName && this.price && this.price > 0) {
      this.inventoryService.addExpense({
        productName: this.productName,
        price: this.price,
        notes: this.notes
      });

      // Reset form
      this.productName = '';
      this.price = null;
      this.notes = '';
    }
  }
}
