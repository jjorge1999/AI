import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { CustomerService } from '../../services/customer.service';
import { DialogService } from '../../services/dialog.service';
import { Product, Sale, Customer } from '../../models/inventory.models';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-inventory-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventory-list.component.html',
  styleUrl: './inventory-list.component.css',
})
// Inventory List Component
export class InventoryListComponent implements OnInit, OnDestroy {
  products: Product[] = [];
  sales: Sale[] = [];
  customers: Customer[] = [];
  private subscriptions: Subscription = new Subscription();

  // Category filter
  selectedCategory: string = 'All';
  categories: string[] = [
    'All',
    'Lechon',
    'Hollow blocks',
    'Sand and Gravel',
    'Copra',
    'Others',
  ];

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

  // Pagination for Pending Deliveries (New)
  pendingPage = 1;
  pendingPageSize = 10;

  // Edit Modal State
  isEditModalOpen = false;
  editingProduct: Product | null = null;
  editProductName: string = '';
  editProductQuantity: number = 0;
  editProductPrice: number = 0;
  editProductImage: string = '';
  editImagePreview: string | null = null;

  // Restock Modal State
  isRestockModalOpen = false;
  restockingProduct: Product | null = null;
  restockQuantity: number = 0;

  constructor(
    private inventoryService: InventoryService,
    private customerService: CustomerService,
    private dialogService: DialogService
  ) {}

  ngOnInit(): void {
    // Load customers for credit calculation on sale completion
    this.customerService.loadCustomers();

    this.subscriptions.add(
      this.inventoryService.getProducts().subscribe((products) => {
        this.products = products;
      })
    );

    this.subscriptions.add(
      this.inventoryService.getSales().subscribe((sales) => {
        this.sales = sales;
      })
    );

    this.subscriptions.add(
      this.customerService.getCustomers().subscribe((customers) => {
        this.customers = customers;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get pendingSales(): Sale[] {
    return this.sales.filter((s) => s.pending === true);
  }

  get groupedPendingSales(): any[] {
    const groups = new Map<string, Sale[]>();
    const singles: Sale[] = [];

    this.pendingSales.forEach((sale) => {
      if (sale.orderId) {
        if (!groups.has(sale.orderId)) {
          groups.set(sale.orderId, []);
        }
        groups.get(sale.orderId)!.push(sale);
      } else {
        singles.push(sale);
      }
    });

    const result: any[] = [];

    // Process Groups
    groups.forEach((sales, orderId) => {
      const first = sales[0];
      const customerName = this.getCustomerName(first);
      result.push({
        isGroup: true,
        orderId: orderId,
        sales: sales,
        total: sales.reduce((sum, s) => sum + s.total, 0),
        productName: `Order #${orderId.substring(4, 10)}...`,
        quantityCount: sales.length,
        items: sales,
        timestamp: first.timestamp,
        deliveryDate: first.deliveryDate,
        deliveryNotes: first.deliveryNotes,
        pending: true,
        customerName: customerName,
        reservationStatus: first.reservationStatus,
      });
    });

    // Process Singles
    singles.forEach((sale) => {
      const customerName = this.getCustomerName(sale);
      result.push({
        isGroup: false,
        sales: [sale],
        total: sale.total,
        productName: sale.productName,
        quantityCount: 1,
        items: [sale],
        timestamp: sale.timestamp,
        deliveryDate: sale.deliveryDate,
        deliveryNotes: sale.deliveryNotes,
        pending: true,
        customerName: customerName,
        reservationStatus: sale.reservationStatus,
      });
    });

    return result.sort((a, b) => {
      const aTime = a.deliveryDate
        ? new Date(a.deliveryDate).getTime()
        : Infinity;
      const bTime = b.deliveryDate
        ? new Date(b.deliveryDate).getTime()
        : Infinity;
      return aTime - bTime;
    });
  }

  get filteredSales(): Sale[] {
    // Exclude pending sales; only show completed ones
    const completed = this.sales.filter((s) => s.pending !== true);
    if (this.selectedCategory === 'All') {
      return completed;
    }
    return completed.filter((s) => s.category === this.selectedCategory);
  }

  get availableProducts(): Product[] {
    return this.products.filter((p) => p.quantity > 0);
  }

  get paginatedAvailableProducts(): Product[] {
    const start =
      (this.availableProductsPage - 1) * this.availableProductsPageSize;
    const end = start + this.availableProductsPageSize;
    return this.availableProducts.slice(start, end);
  }

  get availableProductsTotalPages(): number {
    return Math.ceil(
      this.availableProducts.length / this.availableProductsPageSize
    );
  }

  get outOfStockProducts(): Product[] {
    return this.products.filter((p) => p.quantity === 0);
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

    // Only consider delivered (non-pending) sales for analytics
    this.sales
      .filter((s) => !s.pending)
      .forEach((sale) => {
        const existing = categoryMap.get(sale.category) || {
          total: 0,
          count: 0,
        };
        categoryMap.set(sale.category, {
          total: existing.total + sale.total,
          count: existing.count + 1,
        });
      });

    return Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      total: data.total,
      count: data.count,
    }));
  }

  get totalInventoryValue(): number {
    return this.products.reduce((sum, p) => sum + p.price * p.quantity, 0);
  }

  get totalSalesValue(): number {
    // Only consider delivered (non-pending) sales
    return this.sales
      .filter((s) => !s.pending)
      .reduce((sum, s) => sum + s.total, 0);
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

  // Pagination getters & methods for Pending Sales
  get paginatedPendingSales(): any[] {
    const start = (this.pendingPage - 1) * this.pendingPageSize;
    const end = start + this.pendingPageSize;
    return this.groupedPendingSales.slice(start, end);
  }

  get pendingTotalPages(): number {
    return Math.ceil(this.groupedPendingSales.length / this.pendingPageSize);
  }

  nextPendingPage(): void {
    if (this.pendingPage < this.pendingTotalPages) {
      this.pendingPage++;
    }
  }

  prevPendingPage(): void {
    if (this.pendingPage > 1) {
      this.pendingPage--;
    }
  }

  goToPendingPage(page: number): void {
    this.pendingPage = page;
  }

  onPendingPageSizeChange(): void {
    this.pendingPage = 1;
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
    this.restockingProduct = product;
    this.restockQuantity = 0;
    this.isRestockModalOpen = true;
  }

  closeRestockModal(): void {
    this.isRestockModalOpen = false;
    this.restockingProduct = null;
    this.restockQuantity = 0;
  }

  confirmRestock(): void {
    if (this.restockingProduct && this.restockQuantity > 0) {
      this.inventoryService.restockProduct(
        this.restockingProduct.id,
        this.restockQuantity
      );
      this.closeRestockModal();
    }
  }

  openEditModal(product: Product): void {
    this.editingProduct = product;
    this.editProductName = product.name;
    this.editProductQuantity = product.quantity;
    this.editProductPrice = product.price;
    this.editProductImage = product.imageUrl || '';
    this.editImagePreview = product.imageUrl || null;
    this.isEditModalOpen = true;
  }

  closeEditModal(): void {
    this.isEditModalOpen = false;
    this.editingProduct = null;
    this.editProductName = '';
    this.editProductQuantity = 0;
    this.editProductPrice = 0;
    this.editProductImage = '';
    this.editImagePreview = null;
  }

  onEditImageChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];

      // Limit raw file size check (e.g. 10MB limit before trying to process)
      if (file.size > 10 * 1024 * 1024) {
        this.dialogService.warning(
          'File is too large. Please select an image under 10MB.',
          'File Too Large'
        );
        return;
      }

      const reader = new FileReader();

      reader.onload = (e: ProgressEvent<FileReader>) => {
        const img = new Image();
        img.src = e.target?.result as string;

        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Resize logic: Max dimension 800px
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
            // Compress to JPEG with 0.7 quality
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

            this.editImagePreview = dataUrl;
            this.editProductImage = dataUrl;
          }
        };
      };

      reader.readAsDataURL(file);
    }
  }

  removeEditImage(): void {
    this.editImagePreview = null;
    this.editProductImage = '';
  }

  saveProductEdit(): void {
    if (!this.editingProduct) return;

    if (!this.editProductName.trim()) {
      this.dialogService.warning(
        'Product name cannot be empty',
        'Validation Error'
      );
      return;
    }

    if (this.editProductQuantity < 0) {
      this.dialogService.warning(
        'Quantity cannot be negative',
        'Validation Error'
      );
      return;
    }

    if (this.editProductPrice < 0) {
      this.dialogService.warning(
        'Price cannot be negative',
        'Validation Error'
      );
      return;
    }

    const updatedProduct: Product = {
      ...this.editingProduct,
      name: this.editProductName,
      quantity: this.editProductQuantity,
      price: this.editProductPrice,
      imageUrl: this.editProductImage,
    };

    this.inventoryService.updateProduct(updatedProduct);
    this.closeEditModal();
  }

  // Get customer name by ID or from sale record
  getCustomerName(sale: Sale): string {
    // First check if customerName is already in the sale
    if (sale.customerName) {
      return sale.customerName;
    }

    // If not, try to look up by customerId
    if (sale.customerId) {
      const customer = this.customers.find((c) => c.id === sale.customerId);
      if (customer) {
        return customer.name;
      }
    }

    return '';
  }

  // Mark a pending delivery as delivered
  markAsDelivered(group: any): void {
    const message = group.isGroup
      ? `Mark all ${group.quantityCount} items in this order as delivered?`
      : `Mark "${group.productName}" as delivered?`;

    this.dialogService
      .confirm(message, 'Mark as Delivered')
      .subscribe((confirmed) => {
        if (confirmed) {
          group.sales.forEach((sale: Sale) => {
            this.inventoryService.completePendingSale(sale.id);
          });
        }
      });
  }

  // Cancel a pending delivery
  cancelDelivery(group: any): void {
    const message = group.isGroup
      ? `Cancel all ${group.quantityCount} items in this order? This action cannot be undone.`
      : `Cancel delivery for "${group.productName}"? This action cannot be undone.`;

    this.dialogService
      .confirm(message, 'Cancel Delivery')
      .subscribe((confirmed) => {
        if (confirmed) {
          group.sales.forEach((sale: Sale) => {
            this.inventoryService.deleteSale(sale.id);
          });
        }
      });
  }

  // Confirm a reservation (deducts from inventory)
  confirmReservation(group: any): void {
    const message = group.isGroup
      ? `Confirm all ${group.quantityCount} items in this order? This will deduct items from inventory.`
      : `Confirm reservation for "${group.productName}"? This will deduct items from inventory.`;

    this.dialogService
      .confirm(message, 'Confirm Reservation')
      .subscribe((confirmed) => {
        if (confirmed) {
          group.sales.forEach((sale: Sale) => {
            this.inventoryService.confirmReservation(sale);
          });
        }
      });
  }

  // Edit pending delivery modal state
  isEditDeliveryModalOpen = false;
  editingDeliveryGroup: any = null;
  editDeliveryDate: string = '';
  editDeliveryNotes: string = '';

  openEditDeliveryModal(group: any): void {
    this.editingDeliveryGroup = group;
    const firstSale = group.sales[0];
    this.editDeliveryDate = firstSale.deliveryDate
      ? new Date(firstSale.deliveryDate).toISOString().split('T')[0]
      : '';
    this.editDeliveryNotes = firstSale.deliveryNotes || '';
    this.isEditDeliveryModalOpen = true;
  }

  closeEditDeliveryModal(): void {
    this.isEditDeliveryModalOpen = false;
    this.editingDeliveryGroup = null;
    this.editDeliveryDate = '';
    this.editDeliveryNotes = '';
  }

  saveDeliveryEdit(): void {
    if (!this.editingDeliveryGroup) return;

    const newDate = this.editDeliveryDate
      ? new Date(this.editDeliveryDate)
      : null;

    this.editingDeliveryGroup.sales.forEach((sale: Sale) => {
      const updatedSale: Sale = {
        ...sale,
        deliveryDate: newDate || sale.deliveryDate,
        deliveryNotes: this.editDeliveryNotes,
      };
      this.inventoryService.updateSale(updatedSale);
    });

    this.closeEditDeliveryModal();
  }
}
