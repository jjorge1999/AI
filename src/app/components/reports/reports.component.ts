import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InventoryService } from '../../services/inventory.service';
import { Sale, Expense } from '../../models/inventory.models';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.css'
})
export class ReportsComponent implements OnInit {
  sales: Sale[] = [];
  expenses: Expense[] = [];

  constructor(private inventoryService: InventoryService) {}

  ngOnInit(): void {
    this.inventoryService.getSales().subscribe(sales => {
      this.sales = sales;
    });

    this.inventoryService.getExpenses().subscribe(expenses => {
      this.expenses = expenses;
    });
  }

  get totalIncome(): number {
    return this.sales
      .filter(s => s.pending !== true)
      .reduce((sum, s) => sum + s.total, 0);
  }

  get totalExpenses(): number {
    return this.expenses.reduce((sum, e) => sum + e.price, 0);
  }

  get netProfit(): number {
    return this.totalIncome - this.totalExpenses;
  }

  get incomePercentage(): number {
    const total = this.totalIncome + this.totalExpenses;
    return total > 0 ? (this.totalIncome / total) * 100 : 0;
  }

  get expensePercentage(): number {
    const total = this.totalIncome + this.totalExpenses;
    return total > 0 ? (this.totalExpenses / total) * 100 : 0;
  }

  get profitMargin(): number {
    return this.totalIncome > 0 ? (this.netProfit / this.totalIncome) * 100 : 0;
  }

  get completedSalesCount(): number {
    return this.sales.filter(s => s.pending !== true).length;
  }

  get pendingSalesCount(): number {
    return this.sales.filter(s => s.pending === true).length;
  }

  get averageSale(): number {
    const completed = this.completedSalesCount;
    return completed > 0 ? this.totalIncome / completed : 0;
  }
}
