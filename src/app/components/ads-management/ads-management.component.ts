import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AdsService } from '../../services/ads.service';
import { Ad, AdFormData } from '../../models/ad.model';
import { DialogService } from '../../services/dialog.service';
import { AiService } from '../../services/ai.service';
import { StoreService } from '../../services/store.service';

@Component({
  selector: 'app-ads-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ads-management.component.html',
  styleUrl: './ads-management.component.css',
})
export class AdsManagementComponent implements OnInit, OnDestroy {
  selectedFilter: 'all' | 'video' | 'image' | 'archived' = 'all';
  selectedStatus: 'all' | 'active' | 'paused' | 'pending' | 'draft' = 'all';
  sortBy: 'newest' | 'oldest' | 'views' | 'title' = 'newest';
  searchQuery = '';
  viewMode: 'grid' | 'list' = 'grid';

  ads: Ad[] = [];
  private subscription = new Subscription();
  private userId = '';

  // Upload modal state
  showUploadModal = false;
  isUploading = false;
  isCompressing = false;
  isGeneratingCaption = false;
  isEditMode = false; // Track if we're editing an existing ad
  editingAdId: string | null = null; // ID of the ad being edited
  uploadForm: AdFormData = {
    title: '',
    type: 'image',
    status: 'draft',
    aspectRatio: '16:9',
    description: '',
    targetUrl: '',
  };

  constructor(
    private readonly adsService: AdsService,
    private readonly dialogService: DialogService,
    private readonly aiService: AiService,
    private readonly storeService: StoreService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    // Get current user ID
    this.userId = localStorage.getItem('jjm_user_id') || 'admin-1';

    // Listen to store changes to refresh ads
    this.subscription.add(
      this.storeService.activeStoreId$.subscribe((storeId) => {
        this.adsService.stopListening();
        this.adsService.startListening(undefined, storeId || undefined);

        // Access Control: Block Free Tier
        if (storeId) {
          this.storeService.getStoreById(storeId).subscribe((store) => {
            const plan = store?.subscriptionPlan || 'Free';
            if (plan === 'Free') {
              this.dialogService.error(
                'Ad Management is not available on Free Tier.',
                'Upgrade Required'
              );
              this.router.navigate(['/home']);
            }
          });
        }
      })
    );

    // Subscribe to ads updates
    this.subscription.add(
      this.adsService.getAds().subscribe((ads) => {
        this.ads = ads;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.adsService.stopListening();
  }

  get filteredAds(): Ad[] {
    let filtered = [...this.ads];

    // Filter by type
    if (this.selectedFilter !== 'all') {
      if (this.selectedFilter === 'video') {
        filtered = filtered.filter((ad) => ad.type === 'video');
      } else if (this.selectedFilter === 'image') {
        filtered = filtered.filter((ad) => ad.type === 'image');
      }
    }

    // Filter by status
    if (this.selectedStatus !== 'all') {
      filtered = filtered.filter((ad) => ad.status === this.selectedStatus);
    }

    // Filter by search query
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (ad) =>
          ad.title.toLowerCase().includes(query) ||
          ad.description?.toLowerCase().includes(query)
      );
    }

    // Sort
    switch (this.sortBy) {
      case 'newest':
        filtered.sort(
          (a, b) => b.uploadDate.getTime() - a.uploadDate.getTime()
        );
        break;
      case 'oldest':
        filtered.sort(
          (a, b) => a.uploadDate.getTime() - b.uploadDate.getTime()
        );
        break;
      case 'views':
        filtered.sort((a, b) => (b.views || 0) - (a.views || 0));
        break;
      case 'title':
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }

    return filtered;
  }

  setFilter(filter: 'all' | 'video' | 'image' | 'archived'): void {
    this.selectedFilter = filter;
  }

  setStatus(status: 'all' | 'active' | 'paused' | 'pending' | 'draft'): void {
    this.selectedStatus = status;
  }

  setSortBy(sort: 'newest' | 'oldest' | 'views' | 'title'): void {
    this.sortBy = sort;
  }

  setViewMode(mode: 'grid' | 'list'): void {
    this.viewMode = mode;
  }

  formatViews(views?: number): string {
    if (!views) return '0 Views';
    if (views >= 1000) {
      return `${(views / 1000).toFixed(1)}k Views`;
    }
    return `${views} Views`;
  }

  getTotalViews(): number {
    return this.ads.reduce((sum, ad) => sum + (ad.views || 0), 0);
  }

  getAverageCTR(): number {
    const adsWithCTR = this.ads.filter((ad) => ad.ctr && ad.ctr > 0);
    if (adsWithCTR.length === 0) return 0;
    const totalCTR = adsWithCTR.reduce((sum, ad) => sum + (ad.ctr || 0), 0);
    return parseFloat((totalCTR / adsWithCTR.length).toFixed(2));
  }

  getActiveAdsCount(): number {
    return this.ads.filter((ad) => ad.status === 'active').length;
  }

  getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'active':
        return 'bg-green-500/90';
      case 'paused':
        return 'bg-yellow-600/90';
      case 'pending':
        return 'bg-gray-600/90';
      case 'draft':
        return 'bg-gray-600/90';
      default:
        return 'bg-gray-600/90';
    }
  }

  getAspectRatioClass(aspectRatio: string): string {
    switch (aspectRatio) {
      case '16:9':
        return 'aspect-video';
      case '9:16':
        return 'aspect-[9/16]';
      case '1:1':
        return 'aspect-square';
      case '4:5':
        return 'aspect-[4/5]';
      default:
        return 'aspect-video';
    }
  }

  // ===== CRUD Operations =====

  uploadNewAd(): void {
    this.resetUploadForm();
    this.showUploadModal = true;
  }

  submitAd(): void {
    // Validation
    if (!this.uploadForm.title) {
      this.dialogService.warning(
        'Please enter an ad title.',
        'Missing Information'
      );
      return;
    }

    // For new ads, require media file
    if (!this.isEditMode && !this.uploadForm.mediaFile) {
      this.dialogService.warning(
        'Please select a media file.',
        'Missing Media'
      );
      return;
    }

    this.isUploading = true;

    if (this.isEditMode && this.editingAdId) {
      // UPDATE existing ad
      const updateData: Partial<Ad> = {
        title: this.uploadForm.title,
        status: this.uploadForm.status,
        aspectRatio: this.uploadForm.aspectRatio,
        description: this.uploadForm.description,
        targetUrl: this.uploadForm.targetUrl,
        updatedAt: new Date(),
      };

      // If video with new media file, get duration first
      if (this.uploadForm.type === 'video' && this.uploadForm.mediaFile) {
        this.adsService.getVideoDuration(this.uploadForm.mediaFile).subscribe({
          next: (duration) => {
            (updateData as any).duration = duration;
            this.performUpdate(updateData);
          },
          error: (err) => {
            console.error('Error getting video duration:', err);
            this.performUpdate(updateData); // Continue without duration
          },
        });
      } else {
        this.performUpdate(updateData);
      }
    } else {
      // CREATE new ad
      if (this.uploadForm.type === 'video' && this.uploadForm.mediaFile) {
        this.adsService.getVideoDuration(this.uploadForm.mediaFile).subscribe({
          next: (duration) => {
            (this.uploadForm as any).duration = duration;
            this.performCreate();
          },
          error: (err) => {
            console.error('Error getting video duration:', err);
            this.performCreate(); // Continue without duration
          },
        });
      } else {
        this.performCreate();
      }
    }
  }

  private performUpdate(updateData: Partial<Ad>): void {
    if (!this.editingAdId) return;

    this.adsService.updateAd(this.editingAdId, updateData as any).subscribe({
      next: () => {
        this.dialogService.success('Ad updated successfully!', 'Success');
        this.closeUploadModal();
        this.isUploading = false;
      },
      error: (err) => {
        console.error('Error updating ad:', err);
        this.dialogService.error(
          'Failed to update ad. Please try again.',
          'Update Failed'
        );
        this.isUploading = false;
      },
    });
  }

  private performCreate(): void {
    this.adsService.createAd(this.uploadForm, this.userId).subscribe({
      next: () => {
        this.dialogService.success('Ad uploaded successfully!', 'Success');
        this.closeUploadModal();
        this.isUploading = false;
      },
      error: (err) => {
        console.error('Error creating ad:', err);
        this.dialogService.error(
          'Failed to upload ad. Please try again.',
          'Upload Failed'
        );
        this.isUploading = false;
      },
    });
  }

  toggleAdStatus(ad: Ad): void {
    const newStatus = ad.status === 'active' ? 'paused' : 'active';

    this.adsService.updateAdStatus(ad.id, newStatus).subscribe({
      next: () => {
        this.dialogService.success(
          `Ad ${newStatus === 'active' ? 'activated' : 'paused'} successfully!`,
          'Status Updated'
        );
      },
      error: (err) => {
        console.error('Error updating status:', err);
        this.dialogService.error('Failed to update ad status.', 'Error');
      },
    });
  }

  deleteAd(ad: Ad): void {
    this.dialogService
      .confirm(
        `Are you sure you want to delete "${ad.title}"? This action cannot be undone.`,
        'Delete Ad'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.adsService.deleteAd(ad.id).subscribe({
            next: () => {
              this.dialogService.success('Ad deleted successfully!', 'Deleted');
            },
            error: (err) => {
              console.error('Error deleting ad:', err);
              this.dialogService.error('Failed to delete ad.', 'Error');
            },
          });
        }
      });
  }

  /**
   * Edit an existing ad
   */
  editAd(ad: Ad): void {
    this.isEditMode = true;
    this.editingAdId = ad.id;

    // Populate form with existing ad data
    this.uploadForm = {
      title: ad.title,
      type: ad.type,
      status: ad.status,
      aspectRatio: ad.aspectRatio,
      description: ad.description || '',
      targetUrl: ad.targetUrl || '',
    };

    // Open the modal
    this.showUploadModal = true;
  }

  openAdOptions(ad: Ad): void {
    // Show context menu with options
    const options = ['Change Status', 'Edit', 'Delete'];
    // TODO: Implement context menu or modal with these options
    // console.log('Ad options for:', ad.title);
  }

  // ===== File Handlers =====

  onMediaFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];

      // Validate file type
      if (this.uploadForm.type === 'video') {
        if (!file.type.startsWith('video/')) {
          this.dialogService.warning(
            'Please select a valid video file.',
            'Invalid File'
          );
          return;
        }
      } else {
        if (!file.type.startsWith('image/')) {
          this.dialogService.warning(
            'Please select a valid image file.',
            'Invalid File'
          );
          return;
        }
      }

      this.uploadForm.mediaFile = file;
    }
  }

  onThumbnailFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];

      if (!file.type.startsWith('image/')) {
        this.dialogService.warning(
          'Please select a valid image file for thumbnail.',
          'Invalid File'
        );
        return;
      }

      this.uploadForm.thumbnailFile = file;
    }
  }

  // ===== Modal Handlers =====

  closeUploadModal(): void {
    this.showUploadModal = false;
    this.resetUploadForm();
  }

  private resetUploadForm(): void {
    this.uploadForm = {
      title: '',
      type: 'image',
      status: 'draft',
      aspectRatio: '16:9',
      description: '',
      targetUrl: '',
    };
    this.isEditMode = false;
    this.editingAdId = null;
  }

  // ===== AI Caption Generation =====

  generateAdCaption(): void {
    if (!this.uploadForm.title) {
      this.dialogService.warning(
        'Please enter an Ad Title first to give the AI some context.',
        'Missing Ad Title'
      );
      return;
    }

    // Check AI Credits
    const activeStoreId = this.storeService.getActiveStoreId();
    if (activeStoreId && !this.storeService.hasAiCredits(activeStoreId)) {
      this.dialogService.warning(
        'You have used your AI Ad allocation (1,000 Credits). Upgrade to Pro for Unlimited.',
        'Limit Reached'
      );
      return;
    }

    this.isGeneratingCaption = true;

    // Construct a rich prompt for marketing expert AI
    const adTypeInfo =
      this.uploadForm.type === 'video' ? 'video ad' : 'image ad';
    const aspectInfo = `${this.uploadForm.aspectRatio} aspect ratio`;
    const targetInfo = this.uploadForm.targetUrl
      ? `linking to ${this.uploadForm.targetUrl}`
      : '';

    const context =
      `Ad Title: ${this.uploadForm.title}. Type: ${adTypeInfo}. Format: ${aspectInfo}. ${targetInfo}`.trim();

    const prompt = `You are a senior marketing expert specializing in digital advertising and copywriting. Create compelling ad copy for this advertisement: "${context}".

Respond with a strictly valid JSON object containing one key:
1. "description": A persuasive, engaging, and action-oriented ad caption that will drive conversions (max 50 words, include relevant emojis if appropriate, focus on benefits and call-to-action).

Example response:
{
  "description": "🎯 Transform your business today! Get premium solutions at unbeatable prices. Limited time offer - Don't miss out! 🚀 Click now to discover amazing deals that will elevate your success!"
}

Do not include markdown formatting, code blocks, or explanations. Just the JSON string.`;

    this.aiService.generateWithGemma(prompt).subscribe({
      next: (response) => {
        this.isGeneratingCaption = false;
        if (response) {
          let cleanResponse = response;
          try {
            // Clean up response if it contains markdown code blocks
            cleanResponse = response
              .replace(/```json/g, '')
              .replace(/```/g, '')
              .trim();
            const data = JSON.parse(cleanResponse);

            if (data.description) {
              this.uploadForm.description = data.description;
              // Deduct Credit (Starter)
              if (activeStoreId) {
                this.storeService.deductAiCredit(activeStoreId);
              }
            }
          } catch (e) {
            console.error('Failed to parse AI response', e);
            // Fallback if not JSON
            this.uploadForm.description = cleanResponse || response;
          }
        }
      },
      error: (err) => {
        this.isGeneratingCaption = false;
        console.error('AI Generation Error', err);
        this.dialogService.error(
          'Failed to generate caption. Please try again.',
          'AI Error'
        );
      },
    });
  }
}
