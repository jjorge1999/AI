import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { StoreService } from '../../services/store.service';
import { DialogService } from '../../services/dialog.service';
import { UserService } from '../../services/user.service';
import { AiService } from '../../services/ai.service';
import { Store } from '../../models/inventory.models';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-subscription-pricing',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './subscription-pricing.component.html',
  styleUrl: './subscription-pricing.component.css',
})
export class SubscriptionPricingComponent implements OnInit {
  pricingTiers = [
    {
      name: 'Free Tier',
      price: '₱0',
      period: '/ month',
      description:
        'Get started with digital POS. Perfect for micro-businesses.',
      features: [
        'POS System Only',
        '10 Products Limit',
        '50 Transactions / Month',
        '1 User Account',
        '1 Store Location',
        'Basic Receipts',
      ],
      cta: 'Start Free',
      highlight: false,
      color: 'blue',
      planCode: 'Free',
    },
    {
      name: 'Starter Estimate',
      price: '₱999',
      period: '/ month',
      description: 'Complete inventory & reporting. Better value than Utak.',
      features: [
        'Full Inventory Management',
        'Advanced Sales Reports',
        'Product Kiosk Mode',
        '2,000 Products Limit',
        'Ad Management (1,000 Credits)',
        'AI Chat Auto-Responder (1,000)',
        '2,000 Transactions / Month',
      ],
      cta: 'Choose Starter',
      highlight: true,
      color: 'purple',
      badge: 'Best Value',
      planCode: 'Starter',
    },
    {
      name: 'Pro Revenue',
      price: '₱1,499',
      period: '/ month',
      description: 'Revenue driving tools: AI, Voice & Gamification.',
      features: [
        'Everything in Starter',
        'Unlimited Transactions',
        'Unlimited Ad Management',
        'Unlimited AI Auto-Responder',
        'WebRTC Voice Calls',
        'The Color Game Kiosk',
        'Multi-Store Support',
      ],
      cta: 'Go Professional',
      highlight: false,
      color: 'orange',
      planCode: 'Pro',
    },
  ];

  showPaymentModal = false;
  paymentProofPreview: string | null = null;
  selectedPlanForRenewal: any = null;
  private selectedStoreForRenewal: Store | null = null;
  currentPlan: string | null = null;
  isPublicRequest = false;
  isVerifying = false;
  verificationStatus: string | null = null;

  constructor(
    private router: Router,
    private storeService: StoreService,
    private dialogService: DialogService,
    private userService: UserService,
    private aiService: AiService
  ) {}

  ngOnInit(): void {
    const isLoggedIn = localStorage.getItem('jjm_logged_in') === 'true';
    if (!isLoggedIn) return;

    const activeStoreId = this.storeService.getActiveStoreId();
    if (activeStoreId) {
      this.storeService.stores$.pipe(take(1)).subscribe((stores) => {
        const store = stores.find((s) => s.id === activeStoreId);
        if (store) {
          // Normalize plan string if needed (e.g. handle 'EarlyAdopter' as 'Starter' if comparable)
          this.currentPlan = store.subscriptionPlan || 'Free';
        }
      });
    }
  }

  getButtonLabel(tier: any): string {
    if (!this.currentPlan) return tier.cta; // Not logged in

    // Check if tiered plan matches current plan
    // Simple check: if tier.name includes the current plan code
    // Or better, add 'planCode' to pricingTiers

    // Using name matching fallback
    let tierCode = tier.planCode;
    // Fallback if I didn't add planCode everywhere (I added it above)
    if (!tierCode) {
      if (tier.name.includes('Starter')) tierCode = 'Starter';
      else if (tier.name.includes('Pro')) tierCode = 'Pro';
      else tierCode = 'Free';
    }

    if (this.currentPlan === tierCode) {
      return 'Renew Plan';
    } else {
      // Logic: If current is Free, Starter is Upgrade.
      // User requested "Upgrade plan use Renew Plan".
      // Interpretation: "For logged in users > change wording from Upgrade plan use Renew Plan"
      // Wait: "from Upgrade... use Renew".
      // Usually "Renew" is for same plan. "Upgrade" is for higher.
      // Maybe user means "Change wording [for same plan] from Upgrade to Renew"?
      // Or "Use generic term 'Renew Plan' everywhere"?
      // Context: "for logged in users".
      // I will assume: SAME PLAN = "Renew Plan". DIFFERENT PLAN = "Switch Plan" or "Upgrade Plan".
      // User's phrasing is slightly ambiguous "change wording from Upgrade plan use Renew Plan".
      // Perhaps they previously saw "Upgrade" on their current plan?
      // My previous code didn't show "Upgrade". It accessed `cta`.
      // I will implement:
      // Same Plan -> "Renew Plan"
      // Higher Plan -> "Upgrade Plan"
      // Lower Plan -> "Downgrade" (or just "Select")

      const levels = ['Free', 'Starter', 'Pro', 'Enterprise'];
      const currentLevel = levels.indexOf(this.currentPlan as string);
      const tierLevel = levels.indexOf(tierCode);

      if (tierLevel > currentLevel) return 'Upgrade Plan';
      if (tierLevel < currentLevel) return 'Downgrade Plan';
      return 'Select Plan';
    }
  }

  selectPlan(plan: any): void {
    const isLoggedIn = localStorage.getItem('jjm_logged_in') === 'true';

    // 1. Not Logged In -> Open Modal for Public Request (Show QR, then Email)
    if (!isLoggedIn) {
      this.isPublicRequest = true;
      this.selectedPlanForRenewal = plan;
      this.showPaymentModal = true;
      this.paymentProofPreview = null; // No upload needed locally
      return;
    }

    this.isPublicRequest = false;

    // 2. Logged In -> Open Payment Modal
    const activeStoreId = this.storeService.getActiveStoreId();

    if (!activeStoreId) {
      this.dialogService.warning(
        'Please select a store to manage its subscription.'
      );
      return;
    }

    this.storeService.stores$.pipe(take(1)).subscribe((stores) => {
      const store = stores.find((s) => s.id === activeStoreId);
      if (!store) return;

      // Check Downgrade
      const planLevels: { [key: string]: number } = {
        Free: 0,
        Starter: 1,
        Pro: 2,
        Enterprise: 3,
      };
      const currentLevel = planLevels[store.subscriptionPlan || 'Free'] || 0;

      let newPlanCode = 'Free';
      if (plan.name.includes('Starter')) newPlanCode = 'Starter';
      else if (plan.name.includes('Pro')) newPlanCode = 'Pro';

      const newLevel = planLevels[newPlanCode] || 0;

      const proceed = () => {
        // Skip modal for Free tier
        if (newPlanCode === 'Free') {
          this.processRenewal(store, 'Free');
          return;
        }

        this.selectedStoreForRenewal = store;
        this.selectedPlanForRenewal = plan;
        this.showPaymentModal = true;
        this.paymentProofPreview = null;
      };

      if (newLevel < currentLevel) {
        let warningMsg =
          'Warning: Downgrading will reset your subscription expiry date to start from today. Any remaining time on your current plan will be forfeited.';

        if (newPlanCode === 'Free') {
          warningMsg =
            'Warning: You are about to downgrade to the Free Tier. You will LOSE ACCESS to all premium features including unlimited products, AI tools, and advanced reports. Your subscription expiry will also be reset. Are you sure you want to continue?';
        }

        this.dialogService
          .confirm(warningMsg, 'Confirm Downgrade')
          .subscribe((confirmed) => {
            if (confirmed) proceed();
          });
      } else {
        proceed();
      }
    });
  }

  detectedRefNumber: string | null = null;

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];

      // Basic size check (5MB)
      if (file.size > 5 * 1024 * 1024) {
        this.dialogService.warning('File size must be less than 5MB');
        return;
      }

      const reader = new FileReader();
      const todayDate = new Date().toDateString();

      this.isVerifying = true;
      this.verificationStatus = 'Running forensic analysis...';
      this.paymentProofPreview = null; // Reset prev
      this.detectedRefNumber = null;

      reader.onload = (e: any) => {
        const base64 = e.target.result;
        const expectedPrice = this.selectedPlanForRenewal?.price || '';

        const prompt = `Act as a forensic document expert. Verify this payment receipt.
Context: Expected Amount: ~${expectedPrice} (Allow +50 fee). Current Date: ${todayDate}.

Checks:
1. **Reference Number**: Extract the specific Transaction Reference/Confirmation Number.
2. **Visual Integrity**: Look for font inconsistencies, pixelation around numbers (signs of editing), or alignment issues.
3. **Timestamp Logic**: Date must be recent (last 7 days) and NOT in the future.
4. **Amount**: Matches expected amount (with fee tolerance).

Reply ONLY in strict JSON format:
{
  "valid": boolean,
  "referenceNumber": "string or null",
  "reason": "string (brief explanation)"
}`;

        this.aiService.analyzeImage(base64, prompt).subscribe((result) => {
          this.isVerifying = false;
          let isValid = false;
          let reason = 'Analysis failed';

          try {
            // Attempt to parse JSON (sometimes models add markdown code blocks)
            const cleanResult =
              result
                ?.replace(/```json/g, '')
                .replace(/```/g, '')
                .trim() || '{}';
            const analysis = JSON.parse(cleanResult);
            isValid = analysis.valid === true;
            reason = analysis.reason || 'Unknown error';
            this.detectedRefNumber = analysis.referenceNumber || null;
          } catch (e) {
            // Fallback if JSON fails, strictly assume invalid if we asked for JSON
            console.warn('AI Parsing Error', e);
            isValid = false;
            reason = 'Could not verify document structure';
          }

          if (isValid) {
            this.paymentProofPreview = base64;
            this.verificationStatus =
              'Verified: ' + (this.detectedRefNumber || 'No Ref');
          } else {
            this.dialogService.warning(
              `Verification Refused: ${reason}. Please ensure the receipt is valid, unedited, and recent.`
            );
            this.verificationStatus = 'Rejected: ' + reason;
            input.value = '';
          }
        });
      };
      reader.readAsDataURL(file);
    }
  }

  closePaymentModal(): void {
    this.showPaymentModal = false;
    this.paymentProofPreview = null;
    this.selectedPlanForRenewal = null;
    this.selectedStoreForRenewal = null;
  }

  confirmPayment(): void {
    if (this.isPublicRequest) {
      if (!this.selectedPlanForRenewal) return;

      const plan = this.selectedPlanForRenewal;
      const subject = `Subscription Request: ${plan.name}`;
      const body = `I would like to subscribe to the ${plan.name} plan.\n\nAttached is my payment proof.\n\nName:\nContact:`;
      globalThis.window.location.href = `mailto:inventoryjjm@gmail.com?subject=${encodeURIComponent(
        subject
      )}&body=${encodeURIComponent(body)}`;

      this.closePaymentModal();
      return;
    }

    if (!this.paymentProofPreview) {
      this.dialogService.warning('Please upload a verified proof of payment.');
      return;
    }

    if (this.selectedStoreForRenewal && this.selectedPlanForRenewal) {
      let planCode: 'Free' | 'Starter' | 'Pro' = 'Free';
      if (this.selectedPlanForRenewal.name.includes('Starter'))
        planCode = 'Starter';
      else if (this.selectedPlanForRenewal.name.includes('Pro'))
        planCode = 'Pro';

      this.processRenewal(this.selectedStoreForRenewal, planCode);
      this.closePaymentModal();
    }
  }

  private processRenewal(
    store: Store,
    newPlan: 'Free' | 'Starter' | 'Pro'
  ): void {
    const today = new Date();

    // Plan Levels for Comparison
    const planLevels: { [key: string]: number } = {
      Free: 0,
      Starter: 1,
      Pro: 2,
      Enterprise: 3,
    };
    const currentLevel = planLevels[store.subscriptionPlan || 'Free'] || 0;
    const newLevel = planLevels[newPlan] || 0;

    // If upgrading/renewing to a PAID plan, require Admin Approval
    if (newPlan !== 'Free') {
      const updatedStore: Partial<Store> = {
        pendingSubscription: {
          plan: newPlan as any,
          proofUrl: this.paymentProofPreview || '',
          requestDate: new Date(),
          referenceNumber: this.detectedRefNumber || undefined,
        },
      };

      this.storeService
        .updateStore(store.id, updatedStore)
        .pipe(take(1))
        .subscribe(() => {
          this.dialogService.success(
            'Request Submitted! AI verified Ref: ' +
              (this.detectedRefNumber || 'N/A'),
            'Pending Approval'
          );
        });
      return;
    }

    // Downgrade to Free is Immediate
    let expiryDate: Date;

    if (newLevel < currentLevel) {
      // Downgrade: Reset expiry to start fresh from today
      expiryDate = new Date(); // Today
    } else {
      // Should not happen if only Free is immediate, but keep logic safe
      expiryDate = new Date();
    }

    // Add 30 days (Free tier implies basic access?)
    // Actually Free tier usually doesn't expire or has 30 days renewable?
    // Let's assume Free tier also has expiration/renewal cycle for tracking.
    expiryDate.setDate(expiryDate.getDate() + 30);

    // Calculate Credits
    const currentCredits = store.credits || {
      ai: 0,
      aiResponse: 0,
      transactions: 0,
      callMinutes: 0,
      lastResetDate: new Date(),
    };

    // Logic: Free (Reset to 50)
    let newTransactions = 50;

    const updates: Partial<Store> = {
      subscriptionPlan: 'Free', // newPlan is guaranteed Free here
      subscriptionExpiryDate: expiryDate.toISOString().split('T')[0],
      credits: {
        ...currentCredits,
        ai: 10, // Free AI limit for now
        aiResponse: 10, // Free Chat limit
        transactions: newTransactions,
        lastResetDate: new Date(),
      },
      pendingSubscription: undefined, // Clear any pending
    };

    // Execute Update immediately (User already confirmed via Payment Modal)
    if (store.id) {
      this.storeService.updateStore(store.id, updates).subscribe({
        next: () => {
          // Sync User Account Expiration
          const currentUserId = localStorage.getItem('jjm_user_id');
          if (currentUserId) {
            this.userService
              .updateUser({
                id: currentUserId,
                accessExpiryDate: expiryDate,
              })
              .subscribe({
                error: (e) => console.warn('Failed to sync user expiry', e),
              });
          }

          this.dialogService.success(
            `Successfully ${
              newPlan === store.subscriptionPlan ? 'renewed' : 'upgraded to'
            } ${newPlan} plan!`
          );
          // Update local state to reflect change immediately if needed, or rely on observable
          this.router.navigate(['/home']);
        },
        error: (err) => {
          console.error('Renewal failed', err);
          this.dialogService.error(
            'Failed to update subscription. Please try again.'
          );
        },
      });
    }
  }

  goBack(): void {
    this.router.navigate(['/home']);
  }
}
