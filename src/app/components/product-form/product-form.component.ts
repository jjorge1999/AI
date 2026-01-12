import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { InventoryService } from '../../services/inventory.service';
import {
  Product,
  Category,
  RecipeItem,
  RawMaterial,
} from '../../models/inventory.models';
import { DialogService } from '../../services/dialog.service';
import { AiService } from '../../services/ai.service';

interface ProductStats {
  totalProducts: number;
  lowStockCount: number;
  totalValue: number;
  totalPotentialProfit: number;
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
  stats: ProductStats = {
    totalProducts: 0,
    lowStockCount: 0,
    totalValue: 0,
    totalPotentialProfit: 0,
  };

  // Filters
  searchQuery = '';
  categoryFilter = '';
  stockFilter = '';
  categories: Category[] = [];

  // Category management
  showCategoryModal = false;
  newCategoryName = '';

  // Raw Material database management
  rawMaterialsDb: RawMaterial[] = [];
  showRawMaterialModal = false;
  editingRawId: string | null = null;
  rawMaterialForm = {
    name: '',
    cost: 0,
  };

  isAiLoading = false;
  aiSuggestions: Partial<RawMaterial>[] = [];

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
    cost: 0,
    quantity: 0,
    isRawMaterial: false,
    recipe: [] as RecipeItem[],
    imageUrl: '',
  };

  imagePreview: string | null = null;

  private subscription: Subscription | null = null;
  private readonly LOW_STOCK_THRESHOLD = 10;

  constructor(
    private inventoryService: InventoryService,
    private dialogService: DialogService,
    private aiService: AiService
  ) {}

  get rawMaterials(): RawMaterial[] {
    return this.rawMaterialsDb;
  }

  ngOnInit(): void {
    this.subscription = this.inventoryService
      .getProducts()
      .subscribe((products) => {
        this.products = products;
        this.calculateStats();
        this.applyFilters();
      });

    this.subscription.add(
      this.inventoryService.getCategories().subscribe((categories) => {
        this.categories = categories;
      })
    );

    this.subscription.add(
      this.inventoryService.rawMaterials$.subscribe((raw) => {
        this.rawMaterialsDb = raw;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  // Removed static extractCategories in favor of dynamic categories$ from service

  private calculateStats(): void {
    this.stats.totalProducts = this.products.length;
    this.stats.lowStockCount = this.products.filter(
      (p) => (p.quantity || 0) <= this.LOW_STOCK_THRESHOLD
    ).length;
    this.stats.totalValue = this.products.reduce(
      (sum, p) => sum + p.price * (p.quantity || 0),
      0
    );
    this.stats.totalPotentialProfit = this.products.reduce(
      (sum, p) => sum + (p.price - (p.cost || 0)) * (p.quantity || 0),
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
      cost: product.cost || 0,
      quantity: product.quantity,
      isRawMaterial: product.isRawMaterial || false,
      recipe: product.recipe ? [...product.recipe] : [],
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
      cost: 0,
      quantity: 0,
      isRawMaterial: false,
      recipe: [],
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
          this.inventoryService
            .updateProduct({
              ...existingProduct,
              name: this.product.name,
              category: this.product.category,
              price: this.product.price,
              cost: this.product.cost,
              quantity: this.product.quantity,
              isRawMaterial: true,
              recipe: this.product.recipe,
              imageUrl: this.product.imageUrl,
            })
            .subscribe();
        }
      } else {
        // Add new product
        this.inventoryService
          .addProduct({
            name: this.product.name,
            category: this.product.category,
            price: this.product.price,
            cost: this.product.cost,
            quantity: this.product.quantity,
            isRawMaterial: true,
            recipe: this.product.recipe,
            imageUrl: this.product.imageUrl,
          })
          .subscribe();
      }

      this.closeModal();
    }
  }

  isValid(): boolean {
    return !!(
      this.product.name &&
      this.product.category &&
      this.product.quantity >= 0 &&
      (this.product.cost || 0) >= 0
    );
  }

  // Category Management
  openCategoryModal(): void {
    this.showCategoryModal = true;
  }

  closeCategoryModal(): void {
    this.showCategoryModal = false;
    this.newCategoryName = '';
  }

  addCategory(): void {
    if (this.newCategoryName.trim()) {
      this.inventoryService.addCategory(this.newCategoryName.trim()).subscribe({
        next: () => {
          this.newCategoryName = '';
        },
        error: (err) => {
          const message = err.message || 'Failed to add category';
          this.dialogService.error(message);
        },
      });
    }
  }

  deleteCategory(cat: Category): void {
    this.dialogService
      .confirm(
        `Are you sure you want to delete category "${cat.name}"? products with this category will remain, but the category option will be removed.`,
        'Delete Category'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.inventoryService.deleteCategory(cat.id).subscribe({
            error: (err) => {
              console.error('Error deleting category:', err);
              this.dialogService.error('Failed to delete category');
            },
          });
        }
      });
  }

  // Delete product
  deleteProduct(product: Product): void {
    this.dialogService
      .confirm(
        `Are you sure you want to delete "${product.name}"?`,
        'Delete Product'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.inventoryService.deleteProduct(product.id).subscribe();
        }
      });
  }

  // Recipe management
  selectedIngredientId = '';
  ingredientQuantity = 1;

  addIngredient(): void {
    if (!this.selectedIngredientId) return;

    // Coerce to number to prevent string concatenation
    const qtyToAdd = Number(this.ingredientQuantity);
    if (isNaN(qtyToAdd) || qtyToAdd <= 0) return;

    const raw = this.rawMaterials.find(
      (rm) => rm.id === this.selectedIngredientId
    );

    if (!raw) {
      console.warn('Selected raw material not found in local products list.');
      return;
    }

    // Ensure recipe array exists
    if (!this.product.recipe) {
      this.product.recipe = [];
    }

    const existing = this.product.recipe.find(
      (item) => item.productId === raw.id
    );

    if (existing) {
      existing.quantity = Number(existing.quantity) + qtyToAdd;
    } else {
      this.product.recipe.push({
        productId: raw.id,
        name: raw.name,
        quantity: qtyToAdd,
        unitCost: raw.cost || 0,
      });
    }

    this.autoCalculateCost();
    this.selectedIngredientId = '';
    this.ingredientQuantity = 1;
  }

  removeIngredient(index: number): void {
    this.product.recipe.splice(index, 1);
    this.autoCalculateCost();
  }

  private autoCalculateCost(): void {
    if (this.product.recipe && this.product.recipe.length > 0) {
      this.product.cost = this.product.recipe.reduce(
        (sum, item) =>
          sum + (Number(item.unitCost) || 0) * (Number(item.quantity) || 0),
        0
      );
    } else {
      // Keep manual cost if it exists, or set to 0 if we specifically want
      // the recipe to drive the cost. Let's set it to 0 to be consistent with "automated" behavior.
      // But only if we are in an "automated" state.
      // To be safe and helpful:
      if (this.product.recipe && this.product.recipe.length === 0) {
        // Only reset if they had ingredients and removed them.
        this.product.cost = 0;
      }
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
  // Raw Material Management Logic
  openRawMaterialModal(): void {
    this.resetRawForm();
    this.showRawMaterialModal = true;
  }

  closeRawMaterialModal(): void {
    this.showRawMaterialModal = false;
    this.resetRawForm();
  }

  resetRawForm(): void {
    this.rawMaterialForm = { name: '', cost: 0 };
    this.editingRawId = null;
  }

  editRawMaterial(raw: RawMaterial): void {
    this.editingRawId = raw.id;
    this.rawMaterialForm = {
      name: raw.name,
      cost: raw.cost,
    };
  }

  saveRawMaterial(): void {
    if (!this.rawMaterialForm.name) return;

    if (this.editingRawId) {
      this.inventoryService
        .updateRawMaterial({
          id: this.editingRawId,
          ...this.rawMaterialForm,
          createdAt: new Date(), // Will be ignored by updateDoc
        })
        .subscribe(() => {
          this.resetRawForm();
        });
    } else {
      this.inventoryService
        .addRawMaterial(this.rawMaterialForm)
        .subscribe(() => {
          this.resetRawForm();
        });
    }
  }

  deleteRawMaterialFromDb(id: string): void {
    this.dialogService
      .confirm(
        'Delete Raw Material',
        'Are you sure you want to delete this material? It may affect products using it.'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.inventoryService.deleteRawMaterial(id).subscribe();
        }
      });
  }

  suggestMaterials(): void {
    if (!this.product.name) {
      this.dialogService.alert(
        'Missing Name',
        'Please enter a product name first so AI can suggest ingredients.'
      );
      return;
    }

    this.isAiLoading = true;
    const prompt = `As a professional inventory manager, suggest a list of 5-8 essential raw materials (ingredients) needed to make "${this.product.name}". For each material, provide a name and an estimated bulk purchase cost in Philippine Pesos (PHP) per standard unit. Output ONLY a valid JSON array of objects with keys "name" and "cost". Example: [{"name": "Sugar", "cost": 45}, {"name": "Flour", "cost": 30}]. Do not include any other text.`;

    this.aiService.generateText(prompt).subscribe({
      next: (response) => {
        this.isAiLoading = false;
        if (!response) {
          this.dialogService.alert(
            'AI Error',
            'Could not get suggestions from AI. Please try again.'
          );
          return;
        }

        try {
          // Clean the response in case AI included markdown backticks
          const cleanJson = response.replace(/```json|```/g, '').trim();
          const suggestions = JSON.parse(cleanJson);

          if (Array.isArray(suggestions)) {
            this.aiSuggestions = suggestions;
          } else {
            throw new Error('Response is not an array');
          }
        } catch (e) {
          console.error('Failed to parse AI response:', response);
          this.dialogService.alert(
            'AI Error',
            'The AI provided an invalid format. Try again with a different product name.'
          );
        }
      },
      error: (err) => {
        this.isAiLoading = false;
        this.dialogService.alert(
          'AI Error',
          'Failed to connect to AI service.'
        );
      },
    });
  }

  addSuggestedMaterial(suggestion: any): void {
    const raw = {
      name: suggestion.name,
      cost: Number(suggestion.cost) || 0,
    };

    // Check if already in DB
    const exists = this.rawMaterialsDb.find(
      (m) => m.name.toLowerCase() === raw.name.toLowerCase()
    );
    if (exists) {
      this.dialogService.alert(
        'Already Exists',
        `"${raw.name}" is already in your database.`
      );
      return;
    }

    this.inventoryService.addRawMaterial(raw).subscribe(() => {
      // Remove from suggestions once added
      this.aiSuggestions = this.aiSuggestions.filter((s) => s !== suggestion);
    });
  }

  assumeIngredients(): void {
    if (!this.product.name) {
      this.dialogService.alert(
        'Missing Name',
        'Please enter a product name first.'
      );
      return;
    }

    if (this.rawMaterialsDb.length === 0) {
      this.dialogService.alert(
        'Empty Database',
        'Please add some raw materials to your database first.'
      );
      return;
    }

    this.isAiLoading = true;
    const materialsList = this.rawMaterialsDb
      .map((m) => `- ${m.name} [ID: ${m.id}]`)
      .join('\n');

    const categoryInfo = this.product.category
      ? ` belonging to the "${this.product.category}" category`
      : '';

    const prompt = `As a professional production manager, I am making 1 unit of "${this.product.name}"${categoryInfo}. 
    Choose 3-6 essential ingredients from this list (use EXACT IDs provided):
    ${materialsList}

    Output ONLY a valid JSON array of objects.
    CRITICAL: 
    - Use curly braces {} for objects, NOT square brackets [].
    - Use EXACT IDs from the list. DO NOT add "id" prefix.
    - Format: [{"productId": "...", "quantity": 0.5}, ...]`;

    this.aiService.generateText(prompt).subscribe({
      next: (response) => {
        this.isAiLoading = false;
        if (!response) return;

        try {
          let cleanJson = response.replace(/```json|```/g, '').trim();

          // REPAIR: AI used square brackets for objects [ "key": "val" ]
          if (cleanJson.includes('["productId":')) {
            cleanJson = cleanJson
              .replace(/\[\s*"productId":/g, '{"productId":') // Start of object
              .replace(/"\s*\]/g, '"}') // End of object (trailing string)
              .replace(/(\d+)\s*\]/g, '$1}'); // End of object (trailing number)
          }

          if (!cleanJson.startsWith('[') || !cleanJson.endsWith(']')) {
            throw new Error('Malformed or truncated response');
          }

          const assumptions = JSON.parse(cleanJson);

          if (Array.isArray(assumptions)) {
            let addedCount = 0;
            assumptions.forEach((item) => {
              let pId = item.productId;

              // REPAIR: AI prepended 'id' to the ID
              if (pId && !this.rawMaterialsDb.find((m) => m.id === pId)) {
                if (pId.startsWith('id')) {
                  const stripped = pId.substring(2);
                  if (this.rawMaterialsDb.find((m) => m.id === stripped)) {
                    pId = stripped;
                  }
                }
              }

              const material = this.rawMaterialsDb.find((m) => m.id === pId);
              if (material) {
                const exists = this.product.recipe.find(
                  (r) => r.productId === material.id
                );
                if (!exists) {
                  this.product.recipe.push({
                    productId: material.id,
                    name: material.name,
                    quantity: Number(item.quantity) || 1,
                    unitCost: material.cost,
                  });
                  addedCount++;
                }
              }
            });

            if (addedCount > 0) {
              this.autoCalculateCost();
            } else {
              this.dialogService.alert(
                'AI Note',
                'AI suggested some items, but they were either already in your recipe or mismatched your database IDs.'
              );
            }
          }
        } catch (e) {
          console.error('Failed to parse AI recipe response:', response);
          const isTruncated = !response.trim().endsWith(']');
          this.dialogService.alert(
            'AI Error',
            isTruncated
              ? 'The AI response was cut off because the recipe is too complex. Try again or add items manually.'
              : 'Could not accurately map ingredients. Make sure your raw materials have clear names.'
          );
        }
      },
      error: () => (this.isAiLoading = false),
    });
  }
}
