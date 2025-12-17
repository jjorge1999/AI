import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdsService } from '../../services/ads.service';
import { Ad } from '../../models/ad.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-ads-slider',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ads-slider.component.html',
  styleUrl: './ads-slider.component.css',
})
export class AdsSliderComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('videoPlayer') videoPlayer!: ElementRef<HTMLVideoElement>;

  activeAds: Ad[] = [];
  currentAdIndex = 0;
  currentAd: Ad | null = null;
  isTransitioning = false;
  autoPlayInterval: any;

  // Track ads that failed to load
  private failedAdIds = new Set<string>();

  private subscription = new Subscription();

  // Configuration
  readonly IMAGE_DURATION = 5000; // 5 seconds for images
  readonly TRANSITION_DURATION = 500; // 0.5 seconds transition

  constructor(private adsService: AdsService) {}

  ngOnInit(): void {
    this.loadActiveAds();
  }

  ngAfterViewInit(): void {
    // Start autoplay after view is initialized
    setTimeout(() => this.startAutoPlay(), 1000);
  }

  ngOnDestroy(): void {
    this.stopAutoPlay();
    this.subscription.unsubscribe();
  }

  /**
   * Load only active ads from the service
   */
  private loadActiveAds(): void {
    this.subscription.add(
      this.adsService.getAds().subscribe((ads: Ad[]) => {
        console.log('📢 Ads Slider: Fetched all ads:', ads.length);

        // Filter only active ads
        this.activeAds = ads.filter((ad: Ad) => ad.status === 'active');

        console.log('📢 Ads Slider: Active ads found:', this.activeAds.length);
        if (this.activeAds.length > 0) {
          console.log('📢 Ads Slider: Showing ad:', this.activeAds[0].title);
        }

        if (this.activeAds.length > 0) {
          this.currentAd = this.activeAds[0];
          this.trackImpression(this.currentAd);
        }
      })
    );
  }

  /**
   * Start automatic slideshow
   */
  private startAutoPlay(): void {
    if (this.activeAds.length <= 1) return;

    this.autoPlayInterval = setInterval(() => {
      this.nextSlide();
    }, this.IMAGE_DURATION);
  }

  /**
   * Stop automatic slideshow
   */
  private stopAutoPlay(): void {
    if (this.autoPlayInterval) {
      clearInterval(this.autoPlayInterval);
      this.autoPlayInterval = null;
    }
  }

  /**
   * Go to next slide
   */
  nextSlide(): void {
    if (this.isTransitioning || this.activeAds.length === 0) return;

    this.isTransitioning = true;
    this.currentAdIndex = (this.currentAdIndex + 1) % this.activeAds.length;
    this.currentAd = this.activeAds[this.currentAdIndex];
    this.trackImpression(this.currentAd);

    setTimeout(() => {
      this.isTransitioning = false;
    }, this.TRANSITION_DURATION);

    // Restart autoplay timer
    this.resetAutoPlay();
  }

  /**
   * Go to previous slide
   */
  prevSlide(): void {
    if (this.isTransitioning || this.activeAds.length === 0) return;

    this.isTransitioning = true;
    this.currentAdIndex =
      this.currentAdIndex === 0
        ? this.activeAds.length - 1
        : this.currentAdIndex - 1;
    this.currentAd = this.activeAds[this.currentAdIndex];
    this.trackImpression(this.currentAd);

    setTimeout(() => {
      this.isTransitioning = false;
    }, this.TRANSITION_DURATION);

    this.resetAutoPlay();
  }

  /**
   * Go to specific slide
   */
  goToSlide(index: number): void {
    if (this.isTransitioning || index === this.currentAdIndex) return;

    this.isTransitioning = true;
    this.currentAdIndex = index;
    this.currentAd = this.activeAds[index];
    this.trackImpression(this.currentAd);

    setTimeout(() => {
      this.isTransitioning = false;
    }, this.TRANSITION_DURATION);

    this.resetAutoPlay();
  }

  /**
   * Reset autoplay timer
   */
  private resetAutoPlay(): void {
    this.stopAutoPlay();
    this.startAutoPlay();
  }

  /**
   * Handle video ended event
   */
  onVideoEnded(): void {
    this.nextSlide();
  }

  /**
   * Handle ad click
   */
  onAdClick(ad: Ad): void {
    if (ad.targetUrl) {
      this.trackClick(ad);
      window.open(ad.targetUrl, '_blank');
    }
  }

  /**
   * Track ad impression (view)
   */
  private trackImpression(ad: Ad): void {
    // Log impression for analytics
    console.log(`Ad impression: ${ad.title} (ID: ${ad.id})`);
    // Note: updateAd returns Promise, not Observable
    // For full implementation, wrap in from() from rxjs if needed
  }

  /**
   * Track ad click
   */
  private trackClick(ad: Ad): void {
    console.log(`Ad clicked: ${ad.title} (ID: ${ad.id})`);
    // Log click for analytics
  }

  /**
   * Get aspect ratio class for styling
   */
  getAspectRatioClass(aspectRatio: string): string {
    const ratioMap: { [key: string]: string } = {
      '16:9': 'aspect-video',
      '1:1': 'aspect-square',
      '9:16': 'aspect-[9/16]',
      '4:5': 'aspect-[4/5]',
    };
    return ratioMap[aspectRatio] || 'aspect-video';
  }

  /**
   * Pause autoplay on mouse enter
   */
  onMouseEnter(): void {
    this.stopAutoPlay();
  }

  /**
   * Resume autoplay on mouse leave
   */
  onMouseLeave(): void {
    this.startAutoPlay();
  }

  /**
   * Handle media load error
   */
  onMediaError(ad: Ad): void {
    console.warn(
      `⚠️ Ads Slider: Failed to load media for ad: "${ad.title}" (ID: ${ad.id})`
    );
    console.log(`⚠️ Ads Slider: Media URL: ${ad.mediaUrl}`);

    // Mark this ad as failed
    this.failedAdIds.add(ad.id);

    const beforeCount = this.activeAds.length;

    // Remove from active ads
    this.activeAds = this.activeAds.filter((a) => a.id !== ad.id);

    console.log(
      `⚠️ Ads Slider: Removed 1 failed ad. Remaining: ${this.activeAds.length} (was ${beforeCount})`
    );

    // If we have other ads, show the next one
    if (this.activeAds.length > 0) {
      console.log(
        `✅ Ads Slider: Continuing with ${this.activeAds.length} working ad(s)`
      );

      // Adjust current index if needed
      if (this.currentAdIndex >= this.activeAds.length) {
        this.currentAdIndex = 0;
      }
      this.currentAd = this.activeAds[this.currentAdIndex];
      console.log(`✅ Ads Slider: Now showing: "${this.currentAd.title}"`);
    } else {
      // No ads left
      console.error(
        `❌ Ads Slider: All ads failed to load. Slider will be hidden.`
      );
      this.currentAd = null;
      this.stopAutoPlay();
    }
  }

  /**
   * Filter out failed ads from the list
   */
  private filterFailedAds(ads: Ad[]): Ad[] {
    return ads.filter((ad) => !this.failedAdIds.has(ad.id));
  }
}
