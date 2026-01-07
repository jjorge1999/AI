import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StoreService } from '../../services/store.service';
import { Store, User } from '../../models/inventory.models';
import { DialogService } from '../../services/dialog.service';
import { InventoryService } from '../../services/inventory.service';
import { UserService } from '../../services/user.service';
import { Subscription, combineLatest } from 'rxjs';

@Component({
  selector: 'app-store-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './store-management.component.html',
  styleUrls: ['./store-management.component.css'],
  host: {
    '(keydown.escape)': 'closeModal()',
  },
})
export class StoreManagementComponent implements OnInit, OnDestroy {
  stores: Store[] = [];
  filteredStores: Store[] = [];
  searchQuery = '';
  pendingRenewals: Store[] = [];
  canApproveRenewals = false; // Restricted to Super Admin of Super Branch

  isModalOpen = false;
  isEditing = false;
  editingStoreId: string | null = null;
  proofPreview: string | null = null; // For modal

  storeForm: any = {
    name: '',
    address: '',
    phoneNumber: '',
    description: '',
    isActive: true,
    isSuperAdminOnly: false,
    logoUrl: '',
    subscriptionPlan: 'Free',
    subscriptionExpiryDate: '',
  };

  logoPreview: string | null = null;

  // Stats mapping
  storeStats: {
    [key: string]:
      | {
          products: number;
          sales: number;
          admins: number;
          staff: number;
        }
      | undefined;
  } = {};

  currentUser: User | null = null;

  private readonly sub = new Subscription();

  constructor(
    private readonly storeService: StoreService,
    private readonly dialogService: DialogService,
    private readonly inventoryService: InventoryService,
    private readonly userService: UserService
  ) {}

  ngOnInit(): void {
    this.sub.add(
      combineLatest([
        this.storeService.stores$,
        this.inventoryService.getProducts(),
        this.inventoryService.getSales(),
        this.userService.users$,
        this.userService.currentUser$,
      ]).subscribe(([stores, products, sales, users, currentUser]) => {
        this.stores = stores;
        this.pendingRenewals = stores.filter((s) => !!s.pendingSubscription);

        this.currentUser = currentUser;

        // Check Permissions: Only Super Admin under a Super Branch can approve renewals
        const userStore = stores.find((s) => s.id === currentUser?.storeId);
        this.canApproveRenewals =
          currentUser?.role === 'super-admin' && !!userStore?.isSuperAdminOnly;

        // Calculate stats for each store
        this.storeStats = {};
        stores.forEach((store) => {
          this.storeStats[store.id] = {
            products: products.filter((p) => p.storeId === store.id).length,
            sales: sales.filter((s) => s.storeId === store.id).length,
            admins: users.filter(
              (u) => u.storeId === store.id && u.role === 'super-admin'
            ).length,
            staff: users.filter(
              (u) =>
                u.storeId === store.id &&
                (u.role === 'admin' || u.role === 'user')
            ).length,
          };
        });

        this.applyFilter();
      })
    );
    this.storeService.loadStores();
    this.inventoryService.reloadData();
    this.userService.loadUsers();
  }

  viewProof(store: Store): void {
    if (store.pendingSubscription?.proofUrl) {
      // Simple open in new tab or modal
      // Using modal approach since I can't easily add another modal HTML here without replace_content
      // Just opening in new window for now or using a quick dialog approach
      const win = window.open();
      if (win) {
        win.document.write(
          `<img src="${store.pendingSubscription.proofUrl}" style="max-width:100%"/>`
        );
      }
    }
  }

  approveRenewal(store: Store): void {
    if (!store.pendingSubscription) return;

    this.dialogService
      .confirm(
        `Approve ${store.pendingSubscription.plan} for ${store.name}?`,
        'Approve Renewal'
      )
      .subscribe((confirmed) => {
        if (confirmed && store.pendingSubscription) {
          const newPlan = store.pendingSubscription.plan;
          const today = new Date();

          // Plan Logic (0=Free, 1=Starter, 2=Pro)
          const planLevels: { [key: string]: number } = {
            Free: 0,
            Starter: 1,
            Pro: 2,
            Enterprise: 3,
          };
          const currentLevel =
            planLevels[store.subscriptionPlan || 'Free'] || 0;
          const newLevel = planLevels[newPlan] || 0;

          let expiryDate: Date;

          if (newLevel < currentLevel) {
            // Downgrade: Reset expiry to start fresh from today
            expiryDate = new Date();
          } else {
            // Upgrade or Renew: Extend existing date
            expiryDate = store.subscriptionExpiryDate
              ? new Date(store.subscriptionExpiryDate)
              : new Date();
            if (expiryDate < today) expiryDate = new Date();
          }

          // specific logic: Add 30 days
          expiryDate.setDate(expiryDate.getDate() + 30);

          // Credit Logic
          const currentCredits = store.credits || {
            ai: 0,
            aiResponse: 0,
            transactions: 0,
            callMinutes: 0,
            lastResetDate: new Date(),
          };

          let newTransactions = currentCredits.transactions || 0;
          let newAi = currentCredits.ai || 0;
          let newAiResponse = currentCredits.aiResponse || 0;

          // Apply Plan Limits/Credits
          if (newPlan === 'Starter') {
            // Starter: +2000 transactions (Additive), Reset AI (1000)
            newTransactions += 2000;
            newAi = 1000;
            newAiResponse = 1000;
          } else if (newPlan === 'Pro') {
            // Pro: Effectively Unlimited (High cap)
            newTransactions = 100000;
            newAi = 5000;
            newAiResponse = 5000;
          } else if (newPlan === 'Free') {
            newTransactions = 50;
            newAi = 10;
            newAiResponse = 10;
          }

          // Update logic
          this.storeService
            .updateStore(store.id, {
              subscriptionPlan: newPlan,
              subscriptionExpiryDate: expiryDate.toISOString().split('T')[0],
              credits: {
                ...currentCredits,
                transactions: newTransactions,
                ai: newAi,
                aiResponse: newAiResponse,
                lastResetDate: new Date(),
              },
              pendingSubscription: null,
            })
            .subscribe(() => {
              this.dialogService.success('Subscription Approved and Updated.');
              // Force reload if not auto-triggered (Safeguard)
              this.storeService.loadStores();
            });
        }
      });
  }

  rejectRenewal(store: Store): void {
    this.dialogService
      .confirm('Reject this request?', 'Reject Renewal')
      .subscribe((confirmed) => {
        if (confirmed) {
          this.storeService
            .updateStore(store.id, {
              pendingSubscription: null,
            })
            .subscribe(() => {
              this.dialogService.info('Request Rejected.');
              this.storeService.loadStores();
            });
        }
      });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  applyFilter(): void {
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      this.filteredStores = this.stores.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.address?.toLowerCase().includes(q) ||
          s.phoneNumber?.toLowerCase().includes(q)
      );
    } else {
      this.filteredStores = [...this.stores];
    }
  }

  openAddModal(): void {
    this.isEditing = false;
    this.editingStoreId = null;
    this.storeForm = {
      name: '',
      address: '',
      phoneNumber: '',
      description: '',
      isActive: true,
      isSuperAdminOnly: false,
      logoUrl: '',
      subscriptionPlan: 'Free',
    };
    this.logoPreview = null;
    this.isModalOpen = true;
  }

  openEditModal(store: Store): void {
    this.isEditing = true;
    this.editingStoreId = store.id;
    this.storeForm = { ...store };
    this.logoPreview = store.logoUrl || null;
    this.isModalOpen = true;
  }

  closeModal(): void {
    this.isModalOpen = false;
  }

  renewSubscription(): void {
    const today = new Date();
    // Add 30 days (Month Renewal)
    const nextMonth = new Date(today);
    nextMonth.setDate(today.getDate() + 30);

    // Format to YYYY-MM-DD for input[type="date"]
    this.storeForm.subscriptionExpiryDate = nextMonth
      .toISOString()
      .split('T')[0];
    this.dialogService.success(
      'Subscription Expiry set to ' + this.storeForm.subscriptionExpiryDate
    );
  }

  saveStore(): void {
    if (!this.storeForm.name) {
      this.dialogService.error('Store name is required');
      return;
    }

    if (this.isEditing && this.editingStoreId) {
      this.storeService
        .updateStore(this.editingStoreId, this.storeForm)
        .subscribe({
          next: () => {
            this.dialogService.success('Store updated successfully');
            this.closeModal();
          },
          error: (err) => {
            console.error('Update failed:', err);
            const message =
              err.error?.details ||
              err.error?.error ||
              'Failed to update store';
            this.dialogService.error(message);
          },
        });
    } else {
      this.storeService.createStore(this.storeForm).subscribe({
        next: () => {
          this.dialogService.success('Store created successfully');
          this.closeModal();
        },
        error: () => this.dialogService.error('Failed to create store'),
      });
    }
  }

  onDeleteStore(store: Store, event: MouseEvent): void {
    event.stopPropagation();

    if (store.isSuperAdminOnly) {
      this.dialogService.error(
        'This is a protected system-level branch and cannot be deleted.',
        'Action Restricted'
      );
      return;
    }

    this.dialogService
      .confirm(
        'Are you sure you want to delete this store? All associated data might be affected.',
        'Delete Store'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.storeService.deleteStore(store.id).subscribe({
            next: () =>
              this.dialogService.success('Store deleted successfully'),
            error: () => this.dialogService.error('Failed to delete store'),
          });
        }
      });
  }

  onSwitchStore(id: string): void {
    if (!this.canSwitchToStore(id)) {
      this.dialogService.error(
        'Access Denied: You are not assigned to this store branch.',
        'Permission Restricted'
      );
      return;
    }
    this.storeService.setActiveStore(id);
    this.dialogService.success('Switched active store context');
  }

  canSwitchToStore(storeId: string): boolean {
    if (!this.currentUser) return false;
    if (this.currentUser.role === 'super-admin') return true;

    const store = this.stores.find((s) => s.id === storeId);
    if (store?.isSuperAdminOnly) return false;

    // Check if the store ID is in the user's authorized store list
    const authorizedIds = this.currentUser.storeIds || [];
    return (
      authorizedIds.includes(storeId) || this.currentUser.storeId === storeId
    );
  }

  onLogoChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) {
      const file = input.files[0];
      const reader = new FileReader();

      reader.onload = (e: any) => {
        const img = new Image();
        img.src = e.target.result;

        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Compress to max 400px for logos
          const maxDim = 400;
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
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            this.logoPreview = dataUrl;
            this.storeForm.logoUrl = dataUrl;
          }
        };
      };
      reader.readAsDataURL(file);
    }
  }

  removeLogo(): void {
    this.logoPreview = null;
    this.storeForm.logoUrl = '';
  }

  getActiveStoreId(): string | null {
    return this.storeService.getActiveStoreId();
  }

  onMigrateData(): void {
    const activeId = this.getActiveStoreId();
    if (!activeId) {
      this.dialogService.error('Please select an active store first');
      return;
    }

    this.dialogService
      .confirm(
        'Migrate Legacy Data?',
        'This will move all products, sales, and customers that are NOT currently assigned to any store into your ACTIVE store context. This is usually done once when setting up branches.'
      )
      .subscribe((confirmed) => {
        if (confirmed) {
          this.storeService.migrateData(activeId).subscribe({
            next: (res) => {
              const summary = res?.summary || {};
              const total = Object.values(summary).reduce(
                (a: any, b: any) => a + Number(b),
                0
              );
              this.dialogService.success(
                `Migration complete! Successfully moved ${total} records.`
              );
              this.inventoryService.reloadData();
            },
            error: () =>
              this.dialogService.error(
                'Migration failed. Please check network logs.'
              ),
          });
        }
      });
  }
}
