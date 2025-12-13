import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { InventoryService } from '../../services/inventory.service';
import { Product } from '../../models/inventory.models';
import { DialogService } from '../../services/dialog.service';

interface ProductStats {
  totalProducts: number;
  lowStockCount: number;
  totalValue: number;
}

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './product-form.component.html',
  styleUrl: './product-form.component.css',
})
export class ProductFormComponent implements OnInit, OnDestroy {
  // Product list data
  products: Product[] = [];
  filteredProducts: Product[] = [];
  stats: ProductStats = { totalProducts: 0, lowStockCount: 0, totalValue: 0 };

  // Filters
  searchQuery = '';
  categoryFilter = '';
  stockFilter = '';
  categories: string[] = [];

  // Pagination
  currentPage = 1;
  pageSize = 10;
  totalPages = 1;

  // Modal state
  showAddModal = false;
  isEditMode = false;
  editingProductId: string | null = null;

  // Product form
  product = {
    name: '',
    category: '',
    price: 0,
    quantity: 0,
    imageUrl: '',
  };

  imagePreview: string | null = null;

  private subscription: Subscription | null = null;
  private readonly LOW_STOCK_THRESHOLD = 10;

  constructor(
    private inventoryService: InventoryService,
    private dialogService: DialogService
  ) {}

  ngOnInit(): void {
    this.subscription = this.inventoryService
      .getProducts()
      .subscribe((products) => {
        this.products = products;
        this.extractCategories();
        this.calculateStats();
        this.applyFilters();
      });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private extractCategories(): void {
    const cats = new Set(this.products.map((p) => p.category));
    this.categories = Array.from(cats).sort();
  }

  private calculateStats(): void {
    this.stats.totalProducts = this.products.length;
    this.stats.lowStockCount = this.products.filter(
      (p) => (p.quantity || 0) <= this.LOW_STOCK_THRESHOLD
    ).length;
    this.stats.totalValue = this.products.reduce(
      (sum, p) => sum + p.price * (p.quantity || 0),
      0
    );
  }

  applyFilters(): void {
    let result = [...this.products];

    // Search filter
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.id.toLowerCase().includes(query) ||
          p.category.toLowerCase().includes(query)
      );
    }

    // Category filter
    if (this.categoryFilter) {
      result = result.filter((p) => p.category === this.categoryFilter);
    }

    // Stock filter
    if (this.stockFilter) {
      switch (this.stockFilter) {
        case 'in-stock':
          result = result.filter(
            (p) => (p.quantity || 0) > this.LOW_STOCK_THRESHOLD
          );
          break;
        case 'low-stock':
          result = result.filter(
            (p) =>
              (p.quantity || 0) > 0 &&
              (p.quantity || 0) <= this.LOW_STOCK_THRESHOLD
          );
          break;
        case 'out-of-stock':
          result = result.filter((p) => (p.quantity || 0) === 0);
          break;
      }
    }

    // Sort by name
    result.sort((a, b) => a.name.localeCompare(b.name));

    this.totalPages = Math.ceil(result.length / this.pageSize) || 1;
    if (this.currentPage > this.totalPages) {
      this.currentPage = 1;
    }

    // Paginate
    const start = (this.currentPage - 1) * this.pageSize;
    this.filteredProducts = result.slice(start, start + this.pageSize);
  }

  onSearchChange(): void {
    this.currentPage = 1;
    this.applyFilters();
  }

  onFilterChange(): void {
    this.currentPage = 1;
    this.applyFilters();
  }

  prevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.applyFilters();
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.applyFilters();
    }
  }

  // Stock level helpers
  getStockPercent(quantity: number): number {
    const maxStock = 100;
    return Math.min((quantity / maxStock) * 100, 100);
  }

  getStockStatus(quantity: number): 'active' | 'low-stock' | 'out-of-stock' {
    if (quantity === 0) return 'out-of-stock';
    if (quantity <= this.LOW_STOCK_THRESHOLD) return 'low-stock';
    return 'active';
  }

  getStockStatusLabel(quantity: number): string {
    const status = this.getStockStatus(quantity);
    switch (status) {
      case 'active':
        return 'Active';
      case 'low-stock':
        return 'Low Stock';
      case 'out-of-stock':
        return 'Out of Stock';
    }
  }

  // Modal actions
  openAddModal(): void {
    this.isEditMode = false;
    this.editingProductId = null;
    this.resetForm();
    this.showAddModal = true;
  }

  openEditModal(product: Product): void {
    this.isEditMode = true;
    this.editingProductId = product.id;
    this.product = {
      name: product.name,
      category: product.category,
      price: product.price,
      quantity: product.quantity,
      imageUrl: product.imageUrl || '',
    };
    this.imagePreview = product.imageUrl || null;
    this.showAddModal = true;
  }

  closeModal(): void {
    this.showAddModal = false;
    this.resetForm();
  }

  private resetForm(): void {
    this.product = {
      name: '',
      category: '',
      price: 0,
      quantity: 0,
      imageUrl: '',
    };
    this.imagePreview = null;
  }

  // Image handling - compresses all images regardless of size
  onImageChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];

      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        const img = new Image();
        img.src = e.target?.result as string;

        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Compress large images down to max 800px
          const maxDim = 800;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            // Use JPEG at 70% quality for compression
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            this.imagePreview = dataUrl;
            this.product.imageUrl = dataUrl;
          }
        };
      };

      reader.readAsDataURL(file);
    }
  }

  removeImage(): void {
    this.imagePreview = null;
    this.product.imageUrl = '';
  }

  // Form submission
  onSubmit(): void {
    if (this.isValid()) {
      if (this.isEditMode && this.editingProductId) {
        // Update existing product
        const existingProduct = this.products.find(
          (p) => p.id === this.editingProductId
        );
        if (existingProduct) {
          this.inventoryService.updateProduct({
            ...existingProduct,
            name: this.product.name,
            category: this.product.category,
            price: this.product.price,
            quantity: this.product.quantity,
            imageUrl: this.product.imageUrl,
          });
        }
      } else {
        // Add new product
        this.inventoryService.addProduct({
          name: this.product.name,
          category: this.product.category,
          price: this.product.price,
          quantity: this.product.quantity,
          imageUrl: this.product.imageUrl,
        });
      }

      this.closeModal();
    }
  }

  isValid(): boolean {
    return !!(
      this.product.name &&
      this.product.category &&
      this.product.price > 0 &&
      this.product.quantity >= 0
    );
  }

  // Delete product
  async deleteProduct(product: Product): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      `Are you sure you want to delete "${product.name}"?`,
      'Delete Product'
    );

    if (confirmed) {
      this.inventoryService.deleteProduct(product.id);
    }
  }

  // Format helpers
  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }

  formatNumber(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
  }

  get showingFrom(): number {
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get showingTo(): number {
    return Math.min(this.currentPage * this.pageSize, this.products.length);
  }
}
