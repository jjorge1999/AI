import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { Product, Sale } from '../../models/inventory.models';

@Component({
  selector: 'app-inventory-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventory-list.component.html',
  styleUrl: './inventory-list.component.css'
})
export class InventoryListComponent implements OnInit {
  products: Product[] = [];
  sales: Sale[] = [];

  // Category filter
  selectedCategory: string = 'All';
  categories: string[] = ['All', 'Lechon', 'Hollow blocks', 'Sand and Gravel', 'Copra', 'Others'];

  // Page size options
  pageSizeOptions: number[] = [10, 20, 50, 100];

  // Pagination for available products
  availableProductsPage = 1;
  availableProductsPageSize = 10;

  // Pagination for sales
  salesPage = 1;
  salesPageSize = 10;

  // Pagination for out of stock
  outOfStockPage = 1;
  outOfStockPageSize = 10;

  // Edit Modal State
  isEditModalOpen = false;
  editingProduct: Product | null = null;
  editProductName: string = '';
  editProductQuantity: number = 0;
  editProductPrice: number = 0;

  constructor(private inventoryService: InventoryService) {}

  ngOnInit(): void {
    this.inventoryService.getProducts().subscribe(products => {
      this.products = products;
    });

    this.inventoryService.getSales().subscribe(sales => {
      this.sales = sales;
    });
  }

  get pendingSales(): Sale[] {
    return this.sales.filter(s => s.pending === true);
  }

  get filteredSales(): Sale[] {
    // Exclude pending sales; only show completed ones
    const completed = this.sales.filter(s => s.pending !== true);
    if (this.selectedCategory === 'All') {
      return completed;
    }
    return completed.filter(s => s.category === this.selectedCategory);
  }

  get availableProducts(): Product[] {
    return this.products.filter(p => p.quantity > 0);
  }

  get paginatedAvailableProducts(): Product[] {
    const start = (this.availableProductsPage - 1) * this.availableProductsPageSize;
    const end = start + this.availableProductsPageSize;
    return this.availableProducts.slice(start, end);
  }

  get availableProductsTotalPages(): number {
    return Math.ceil(this.availableProducts.length / this.availableProductsPageSize);
  }

  get outOfStockProducts(): Product[] {
    return this.products.filter(p => p.quantity === 0);
  }

  get paginatedOutOfStockProducts(): Product[] {
    const start = (this.outOfStockPage - 1) * this.outOfStockPageSize;
    const end = start + this.outOfStockPageSize;
    return this.outOfStockProducts.slice(start, end);
  }

  get outOfStockTotalPages(): number {
    return Math.ceil(this.outOfStockProducts.length / this.outOfStockPageSize);
  }

  get paginatedSales(): Sale[] {
    const start = (this.salesPage - 1) * this.salesPageSize;
    const end = start + this.salesPageSize;
    return this.filteredSales.slice(start, end);
  }

  get salesTotalPages(): number {
    return Math.ceil(this.filteredSales.length / this.salesPageSize);
  }

  get salesByCategory(): { category: string; total: number; count: number }[] {
    const categoryMap = new Map<string, { total: number; count: number }>();
    
    this.sales.forEach(sale => {
      const existing = categoryMap.get(sale.category) || { total: 0, count: 0 };
      categoryMap.set(sale.category, {
        total: existing.total + sale.total,
        count: existing.count + 1
      });
    });

    return Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      total: data.total,
      count: data.count
    }));
  }

  get totalInventoryValue(): number {
    return this.products.reduce((sum, p) => sum + (p.price * p.quantity), 0);
  }

  get totalSalesValue(): number {
    return this.sales.reduce((sum, s) => sum + s.total, 0);
  }

  // Pagination methods for available products
  nextAvailablePage(): void {
    if (this.availableProductsPage < this.availableProductsTotalPages) {
      this.availableProductsPage++;
    }
  }

  prevAvailablePage(): void {
    if (this.availableProductsPage > 1) {
      this.availableProductsPage--;
    }
  }

  goToAvailablePage(page: number): void {
    if (page >= 1 && page <= this.availableProductsTotalPages) {
      this.availableProductsPage = page;
    }
  }

  // Pagination methods for sales
  nextSalesPage(): void {
    if (this.salesPage < this.salesTotalPages) {
      this.salesPage++;
    }
  }

  prevSalesPage(): void {
    if (this.salesPage > 1) {
      this.salesPage--;
    }
  }

  goToSalesPage(page: number): void {
    if (page >= 1 && page <= this.salesTotalPages) {
      this.salesPage = page;
    }
  }

  // Pagination methods for out of stock
  nextOutOfStockPage(): void {
    if (this.outOfStockPage < this.outOfStockTotalPages) {
      this.outOfStockPage++;
    }
  }

  prevOutOfStockPage(): void {
    if (this.outOfStockPage > 1) {
      this.outOfStockPage--;
    }
  }

  goToOutOfStockPage(page: number): void {
    this.outOfStockPage = page;
  }

  // Page size change handlers
  onAvailablePageSizeChange(): void {
    this.availableProductsPage = 1;
  }

  onSalesPageSizeChange(): void {
    this.salesPage = 1;
  }

  onOutOfStockPageSizeChange(): void {
    this.outOfStockPage = 1;
  }

  // Helper to get page numbers for pagination UI
  getPageNumbers(totalPages: number): number[] {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  onRestock(product: Product): void {
    const quantityStr = prompt(`Enter quantity to add for ${product.name}:`);
    if (quantityStr) {
      const quantity = parseInt(quantityStr, 10);
      if (!isNaN(quantity) && quantity > 0) {
        this.inventoryService.restockProduct(product.id, quantity);
      } else {
        alert('Please enter a valid number greater than 0');
      }
    }
  }

  openEditModal(product: Product): void {
    this.editingProduct = product;
    this.editProductName = product.name;
    this.editProductQuantity = product.quantity;
    this.editProductPrice = product.price;
    this.isEditModalOpen = true;
  }

  closeEditModal(): void {
    this.isEditModalOpen = false;
    this.editingProduct = null;
    this.editProductName = '';
    this.editProductQuantity = 0;
    this.editProductPrice = 0;
  }

  saveProductEdit(): void {
    if (!this.editingProduct) return;

    if (!this.editProductName.trim()) {
      alert('Product name cannot be empty');
      return;
    }

    if (this.editProductQuantity < 0) {
      alert('Quantity cannot be negative');
      return;
    }

    if (this.editProductPrice < 0) {
      alert('Price cannot be negative');
      return;
    }

    const updatedProduct: Product = {
      ...this.editingProduct,
      name: this.editProductName,
      quantity: this.editProductQuantity,
      price: this.editProductPrice
    };

    this.inventoryService.updateProduct(updatedProduct);
    this.closeEditModal();
  }
}
