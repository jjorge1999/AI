import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SaleService } from '../../services/sale.service';
import { InventoryService } from '../../services/inventory.service';
import { DialogService } from '../../services/dialog.service';
import { AiService } from '../../services/ai.service'; // Added
import { SaleEvent } from '../../models/sale.model';
import { Product } from '../../models/inventory.models';
import { Subscription, combineLatest } from 'rxjs';

@Component({
  selector: 'app-sales-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sales-management.component.html',
  styleUrl: './sales-management.component.css',
})
export class SalesManagementComponent implements OnInit, OnDestroy {
  sales: SaleEvent[] = [];
  products: Product[] = [];
  discountedProducts: any[] = [];
  private subscriptions = new Subscription();

  // Stats
  activeCampaignsCount = 0;
  discountedSkusCount = 0;
  avgDiscount = 0;

  // Pagination
  currentPage = 1;
  pageSize = 10;
  math = Math; // Expose Math for template

  // Modal state
  showModal = false;
  isEditing = false;
  currentSale: Partial<SaleEvent> = {};

  // Form fields
  monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  constructor(
    private saleService: SaleService,
    private inventoryService: InventoryService,
    private dialogService: DialogService,
    private aiService: AiService
  ) {}

  isGeneratingAi = false;

  generateAiPitch(): void {
    if (!this.currentSale.name) {
      this.dialogService.alert(
        'Info',
        'Please enter a Sale Name first to give the AI some context.'
      );
      return;
    }

    this.isGeneratingAi = true;

    // Construct a rich prompt
    const discountInfo = this.currentSale.isActualSale
      ? `offering ${
          ((this.currentSale.actualDiscount || 0) +
            (this.currentSale.psychologicalDiscount || 0)) /
          2
        }% real discount`
      : `with amazing deals`;

    const context = `Sale Name: ${this.currentSale.name}. ${discountInfo}. Duration: ${this.currentSale.duration} days.`;

    const prompt = `You are a marketing copywriting expert. Write a catchy, exciting, and short sales pitch for a website banner based on this event: "${context}".
    
    Respond with a strictly valid JSON object containing two keys:
    1. "title": A short catchy headline (include an emoji if appropriate, max 5 words, do not use quotes).
    2. "message": A compelling short description (max 12 words).
    
    Example response:
    {
      "title": "🎄 Mega Holiday Sale!",
      "message": "Get up to 50% off on all holiday items today!"
    }
    
    Do not include markdown formatting, code blocks, or explanations. Just the JSON string.`;

    this.aiService.generateWithGemma(prompt).subscribe({
      next: (response) => {
        this.isGeneratingAi = false;
        if (response) {
          let cleanResponse = response;
          try {
            // Attempt to clean up response if it contains markdown code blocks
            cleanResponse = response
              .replace(/```json/g, '')
              .replace(/```/g, '')
              .trim();
            const data = JSON.parse(cleanResponse);

            if (data.title) this.currentSale.bannerTitle = data.title;
            if (data.message) this.currentSale.bannerMessage = data.message;
          } catch (e) {
            console.error('Failed to parse AI response', e);
            // Fallback if not JSON
            this.currentSale.bannerMessage = cleanResponse || response;
          }
        }
      },
      error: (err) => {
        this.isGeneratingAi = false;
        console.error('AI Generation Error', err);
        this.dialogService.alert(
          'Error',
          'Failed to generate pitch. Please try again.'
        );
      },
    });
  }

  ngOnInit(): void {
    this.saleService.startListening();
    this.inventoryService.reloadData(); // Ensure we have products
    this.subscriptions.add(
      combineLatest([
        this.saleService.getSales(),
        this.inventoryService.products$,
      ]).subscribe(([sales, products]) => {
        this.sales = sales;
        this.products = products;
        this.calculateStats();
        this.updateDiscountedProducts();
      })
    );
  }

  calculateStats() {
    this.activeCampaignsCount = this.sales.filter((s) =>
      this.isSaleActive(s)
    ).length;
  }

  // Sale Type Toggle
  saleType: 'actual' | 'psychological' = 'psychological';

  toggleSaleType(type: 'actual' | 'psychological') {
    this.saleType = type;
    this.updateDiscountedProducts();
  }

  calculateDynamicDiscount(product: Product, baseDiscount: number): number {
    const seed = this.getProductSeed(product.id);
    const baseVariation = (seed % 25) - 15;

    // Stock/Sold Factor Adjustment
    let stockAdjustment = 0;
    if (product.quantity > 20) {
      stockAdjustment = 5 + (seed % 6);
    } else if (product.quantity < 5) {
      stockAdjustment = -5 - (seed % 6);
    }

    const adjusted = Math.min(
      95,
      Math.max(15, baseDiscount + baseVariation + stockAdjustment)
    );
    return Math.round(adjusted / 5) * 5;
  }

  updateDiscountedProducts() {
    this.discountedProducts = [];
    const activeSales = this.sales.filter((s) => this.isSaleActive(s));

    if (activeSales.length === 0) {
      this.discountedSkusCount = 0;
      this.avgDiscount = 0;
      return;
    }

    let totalDiscountPercent = 0;

    this.products.forEach((product) => {
      // Find applying sale
      const applyingSale = activeSales.find((sale) =>
        this.isProductIncludedInSale(product, sale)
      );

      if (applyingSale) {
        // Resolve Strategy
        let isActual = applyingSale.isActualSale;
        let isPsych = applyingSale.isPsychologicalSale;
        let actDiscountBase = applyingSale.actualDiscount || 0;
        let psyDiscountBase = applyingSale.psychologicalDiscount || 0;

        // Fallback for legacy data
        if (isActual === undefined && isPsych === undefined) {
          const type = applyingSale.saleType || 'psychological';
          if (type === 'actual') {
            isActual = true;
            actDiscountBase = applyingSale.discount;
          } else {
            isPsych = true;
            psyDiscountBase = applyingSale.discount;
          }
        }

        // 1. Calculate Sale Price (Actual Strategy)
        let salePrice = product.price;
        if (isActual) {
          const finalActDisc = this.calculateDynamicDiscount(
            product,
            actDiscountBase
          );
          salePrice = product.price * (1 - finalActDisc / 100);
        }

        // 2. Calculate Base/Original Price (Psychological Strategy)
        let basePrice = product.price;
        if (isPsych) {
          const finalPsyDisc = this.calculateDynamicDiscount(
            product,
            psyDiscountBase
          );
          const multiplier = 1 - finalPsyDisc / 100;
          const inflated = salePrice / multiplier;
          basePrice = Math.ceil(inflated / 10) * 10;
        }

        // 3. Calculate Effective Discount % for Badge
        let effectiveDiscount = 0;
        if (basePrice > salePrice) {
          effectiveDiscount = Math.round(
            ((basePrice - salePrice) / basePrice) * 100
          );
        }

        this.discountedProducts.push({
          ...product,
          basePrice: basePrice,
          salePrice: salePrice,
          discountPercent: effectiveDiscount,
          saleName: applyingSale.name,
        });

        totalDiscountPercent += effectiveDiscount;
      }
    });

    this.discountedSkusCount = this.discountedProducts.length;
    this.avgDiscount =
      this.discountedSkusCount > 0
        ? Math.round(totalDiscountPercent / this.discountedSkusCount)
        : 0;

    // Reset pagination
    this.currentPage = 1;
  }

  // Helper for consistent randomization
  private getProductSeed(productId: string): number {
    let hash = 0;
    for (let i = 0; i < productId.length; i++) {
      hash = (hash << 5) - hash + productId.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  // Pagination getters & methods
  get paginatedProducts(): any[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    return this.discountedProducts.slice(
      startIndex,
      startIndex + this.pageSize
    );
  }

  get totalPages(): number {
    return Math.ceil(this.discountedProducts.length / this.pageSize);
  }

  get startRange(): number {
    if (this.discountedProducts.length === 0) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get endRange(): number {
    return Math.min(
      this.currentPage * this.pageSize,
      this.discountedProducts.length
    );
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

  isProductIncludedInSale(product: Product, sale: SaleEvent): boolean {
    // Exclude if matches exclude keywords
    if (sale.excludeKeywords && sale.excludeKeywords.length > 0) {
      const excluded = sale.excludeKeywords.some(
        (kw) =>
          product.name.toLowerCase().includes(kw.toLowerCase()) ||
          product.category.toLowerCase().includes(kw.toLowerCase())
      );
      if (excluded) return false;
    }

    // Include if matches holidayKeywords
    if (sale.holidayKeywords && sale.holidayKeywords.length > 0) {
      const match = sale.holidayKeywords.some(
        (kw) =>
          product.name.toLowerCase().includes(kw.toLowerCase()) ||
          product.category.toLowerCase().includes(kw.toLowerCase())
      );
      if (match) return true;
      // If keywords exist but don't match, we assume strict inclusion?
      // ReservationComponent logic falls through to default exclusion if no keyword match.
      // But typically if you define keywords, you want ONLY those.
      // However, to match ReservationComponent 1:1, we should fall through.
    }

    // Default: items not in construction/hardware categories are on sale
    const defaultExcludedCategories = [
      'construction',
      'hardware',
      'building',
      'industrial',
    ];
    const category = (product.category || '').toLowerCase();

    // If we had strict keywords and didn't match, maybe we shouldn't be here?
    // But ReservationComponent logic is additive.
    // Let's stick to the default exclusion logic as the fallback.
    return !defaultExcludedCategories.some((c) => category.includes(c));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.saleService.stopListening();
  }

  // Check if a sale is currently active
  isSaleActive(sale: SaleEvent): boolean {
    if (!sale.isActive) return false;
    const now = new Date();
    const eventStart = new Date(now.getFullYear(), sale.month - 1, sale.day);
    const eventEnd = new Date(eventStart);
    eventEnd.setDate(eventEnd.getDate() + sale.duration);
    return now >= eventStart && now <= eventEnd;
  }

  // Open modal for new sale
  openAddModal(): void {
    this.isEditing = false;
    this.currentSale = {
      name: '',
      month: new Date().getMonth() + 1,
      day: 1,
      duration: 7,
      discount: 30,
      isActive: true,
      bannerTitle: '',
      bannerMessage: '',
      bannerIcon: '🎉',
      holidayKeywords: [],
      excludeKeywords: [],
      isActualSale: false,
      actualDiscount: 10,
      isPsychologicalSale: true, // Default
      psychologicalDiscount: 30,
    };
    this.showModal = true;
  }

  // Open modal for editing sale
  openEditModal(sale: SaleEvent): void {
    this.isEditing = true;
    this.currentSale = { ...sale };
    this.showModal = true;
  }

  // Close modal
  closeModal(): void {
    this.showModal = false;
    this.currentSale = {};
  }

  // Save sale (add or update)
  saveSale(): void {
    if (!this.currentSale.name) {
      this.dialogService.alert('Error', 'Please enter a sale name.');
      return;
    }

    if (this.isEditing && this.currentSale.id) {
      // Update existing sale
      this.saleService
        .updateSale(this.currentSale.id, this.currentSale)
        .subscribe({
          next: () => {
            this.closeModal();
          },
          error: (err) => {
            this.dialogService.alert(
              'Error',
              'Failed to update sale: ' + err.message
            );
          },
        });
    } else {
      // Add new sale
      const mainDiscount = this.currentSale.isPsychologicalSale
        ? this.currentSale.psychologicalDiscount || 0
        : this.currentSale.actualDiscount || 0;

      const derivedType =
        this.currentSale.isActualSale && !this.currentSale.isPsychologicalSale
          ? 'actual'
          : 'psychological';

      const newSale: Omit<SaleEvent, 'id'> = {
        name: this.currentSale.name || '',
        month: this.currentSale.month || 1,
        day: this.currentSale.day || 1,
        duration: this.currentSale.duration || 7,
        discount: mainDiscount,
        saleType: derivedType,
        isActive: this.currentSale.isActive ?? true,
        bannerTitle: this.currentSale.bannerTitle,
        bannerMessage: this.currentSale.bannerMessage,
        bannerIcon: this.currentSale.bannerIcon,
        holidayKeywords: this.currentSale.holidayKeywords,
        excludeKeywords: this.currentSale.excludeKeywords,
        isActualSale: this.currentSale.isActualSale,
        actualDiscount: this.currentSale.actualDiscount,
        isPsychologicalSale: this.currentSale.isPsychologicalSale,
        psychologicalDiscount: this.currentSale.psychologicalDiscount,
      };
      this.saleService.addSale(newSale).subscribe({
        next: () => {
          this.closeModal();
        },
        error: (err) => {
          this.dialogService.alert(
            'Error',
            'Failed to add sale: ' + err.message
          );
        },
      });
    }
  }

  // Toggle sale active status
  toggleActive(sale: SaleEvent): void {
    if (!sale.id) return;
    this.saleService.toggleSaleActive(sale.id, !sale.isActive).subscribe();
  }

  // Delete sale
  async deleteSale(sale: SaleEvent): Promise<void> {
    if (!sale.id) return;
    const confirmed = await this.dialogService.confirm(
      'Delete Sale',
      `Are you sure you want to delete "${sale.name}"?`
    );
    if (confirmed) {
      this.saleService.deleteSale(sale.id).subscribe();
    }
  }

  // Get holiday keywords as comma-separated string
  get holidayKeywordsString(): string {
    return (this.currentSale.holidayKeywords || []).join(', ');
  }

  set holidayKeywordsString(value: string) {
    this.currentSale.holidayKeywords = value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
  }

  // Get exclude keywords as comma-separated string
  get excludeKeywordsString(): string {
    return (this.currentSale.excludeKeywords || []).join(', ');
  }

  set excludeKeywordsString(value: string) {
    this.currentSale.excludeKeywords = value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
  }

  // Get formatted date string for display
  getDateString(sale: SaleEvent): string {
    return `${this.monthNames[sale.month - 1]} ${sale.day}`;
  }

  // Get end date string
  getEndDateString(sale: SaleEvent): string {
    const start = new Date(new Date().getFullYear(), sale.month - 1, sale.day);
    const end = new Date(start);
    end.setDate(end.getDate() + sale.duration);
    return `${this.monthNames[end.getMonth()]} ${end.getDate()}`;
  }

  getSaleLabel(sale: SaleEvent): string {
    if (sale.isActualSale && sale.isPsychologicalSale) return 'Hybrid Deal';
    if (sale.isActualSale) return 'Actual Deal';
    if (sale.isPsychologicalSale) return 'Psychological';
    // Legacy fallback
    return sale.saleType === 'actual' ? 'Actual Deal' : 'Psychological';
  }

  getSaleClass(sale: SaleEvent): string {
    if (sale.isActualSale && sale.isPsychologicalSale) return 'text-primary';
    if (sale.isActualSale) return 'text-act';
    return 'text-psy';
  }
}
