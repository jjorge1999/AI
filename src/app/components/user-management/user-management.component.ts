import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { UserService } from '../../services/user.service';
import { DialogService } from '../../services/dialog.service';
import { SettingsService } from '../../services/settings.service';
import { User } from '../../models/inventory.models';
import { DeviceService } from '../../services/device.service';
import { StoreService } from '../../services/store.service';
import { Store } from '../../models/inventory.models';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.css',
})
export class UserManagementComponent implements OnInit, OnDestroy {
  users: User[] = [];
  filteredUsers: User[] = [];
  isLoading = false;
  viewMode: 'table' | 'grid' = 'table';
  private subscriptions: Subscription[] = [];

  // Search and filters
  searchQuery = '';
  roleFilter = 'all';
  statusFilter = 'all';
  roles = ['all', 'super-admin', 'admin', 'editor', 'user'];
  availableRoles = ['user', 'editor', 'admin', 'super-admin'];
  isAdmin = false;
  isSuperAdmin = false;

  // Modal state
  isModalOpen = false;
  isEditing = false;

  currentUser: Partial<User> = {
    username: '',
    fullName: '',
    role: 'user',
  };
  formPassword = '';

  // Pagination
  currentPage = 1;
  pageSize = 10;

  // AI Settings
  hfToken = '';
  isGemmaConfigured = false;
  showAiSettings = false;
  isSavingToken = false;

  // Stores for assignment
  availableStores: Store[] = [];

  constructor(
    private userService: UserService,
    private dialogService: DialogService,
    private settingsService: SettingsService,
    private deviceService: DeviceService,
    private storeService: StoreService
  ) {}

  ngOnInit(): void {
    this.loadUsers();
    this.userService.loadUsers();
    this.checkGemmaStatus();

    this.storeService.stores$.subscribe((stores) => {
      this.availableStores = stores;
    });
    this.storeService.loadStores();

    this.subscriptions.push(
      this.settingsService.getSettings().subscribe((settings) => {
        this.isGemmaConfigured = this.settingsService.isGemmaConfigured();
        if (settings.huggingFaceToken && !this.showAiSettings) {
          this.hfToken = settings.huggingFaceToken.substring(0, 10) + '...';
        }
      })
    );

    const userRole = localStorage.getItem('jjm_role');
    this.isAdmin = userRole === 'admin';
    this.isSuperAdmin = userRole === 'super-admin';

    // Restrict available roles for non-super-admins
    if (!this.isSuperAdmin) {
      this.availableRoles = ['user', 'editor', 'admin'];
      this.roles = ['all', 'admin', 'editor', 'user'];
    }

    this.subscriptions.push(
      this.deviceService.isMobile$.subscribe((isMobile) => {
        if (isMobile) {
          this.viewMode = 'grid';
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  loadUsers(): void {
    this.isLoading = true;
    this.subscriptions.push(
      this.userService.getUsers().subscribe((users) => {
        this.users = users;
        this.applyFilters();
        this.isLoading = false;
      })
    );
  }

  applyFilters(): void {
    let result = [...this.users];

    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      result = result.filter(
        (u) =>
          u.username?.toLowerCase().includes(query) ||
          u.fullName?.toLowerCase().includes(query)
      );
    }

    if (this.roleFilter !== 'all') {
      result = result.filter((u) => u.role === this.roleFilter);
    }

    this.filteredUsers = result;
    this.currentPage = 1;
  }

  onSearchChange(): void {
    this.applyFilters();
  }

  onFilterChange(): void {
    this.applyFilters();
  }

  get paginatedUsers(): User[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredUsers.slice(start, start + this.pageSize);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredUsers.length / this.pageSize) || 1;
  }

  get showingFrom(): number {
    return this.filteredUsers.length > 0
      ? (this.currentPage - 1) * this.pageSize + 1
      : 0;
  }

  get showingTo(): number {
    return Math.min(
      this.currentPage * this.pageSize,
      this.filteredUsers.length
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

  // Modal controls
  openAddModal(): void {
    this.isEditing = false;
    this.formPassword = '';
    this.currentUser = {
      username: '',
      fullName: '',
      role: 'user',
    };
    this.isModalOpen = true;
  }

  openEditModal(user: User): void {
    this.isEditing = true;
    this.formPassword = '';
    this.currentUser = { ...user };
    this.isModalOpen = true;
  }

  closeModal(): void {
    this.isModalOpen = false;
  }

  saveUser(): void {
    if (!this.currentUser.username || !this.currentUser.role) {
      this.dialogService
        .error('Please fill in username and role.', 'Validation Error')
        .subscribe();
      return;
    }

    // Security: Only super-admins can create/edit super-admins
    if (this.currentUser.role === 'super-admin' && !this.isSuperAdmin) {
      this.dialogService
        .error(
          'You do not have permission to assign this role.',
          'Security Error'
        )
        .subscribe();
      return;
    }

    if (!this.isEditing && !this.formPassword) {
      this.dialogService
        .error('Password is required for new users.', 'Validation Error')
        .subscribe();
      return;
    }

    if (this.isEditing && this.currentUser.id) {
      const payload: Partial<User> & { id: string } = {
        id: this.currentUser.id,
        username: this.currentUser.username,
        fullName: this.currentUser.fullName,
        address: this.currentUser.address,
        gpsCoordinates: this.currentUser.gpsCoordinates,
        role: this.currentUser.role,
        storeId: this.currentUser.storeId,
        storeIds: this.currentUser.storeIds,
        accessExpiryDate: this.currentUser.accessExpiryDate,
      };

      if (this.formPassword) {
        payload.password = this.formPassword;
      }

      this.userService.updateUser(payload).subscribe(() => {
        this.closeModal();
      });
    } else {
      const currentUserId = localStorage.getItem('jjm_user_id') || 'system';
      const adminStoreId =
        this.userService.currentUser()?.storeId ||
        localStorage.getItem('jjm_store_id');

      const newUser = {
        ...this.currentUser,
        password: this.formPassword,
        createdBy: currentUserId,
        userId: currentUserId,
        storeId: this.currentUser.storeId || adminStoreId,
      } as User;

      this.userService.addUser(newUser).subscribe(() => {
        this.closeModal();
      });
    }
  }

  deleteUser(userId: string): void {
    this.dialogService
      .confirm('Are you sure you want to delete this user?', 'Delete User')
      .subscribe((confirmed) => {
        if (confirmed) {
          this.userService.deleteUser(userId).subscribe();
        }
      });
  }

  // AI Settings
  checkGemmaStatus(): void {
    this.isGemmaConfigured = this.settingsService.isGemmaConfigured();
    const existingToken = this.settingsService.getHuggingFaceToken();
    if (existingToken) {
      this.hfToken = existingToken.substring(0, 10) + '...';
    }
  }

  toggleAiSettings(): void {
    this.showAiSettings = !this.showAiSettings;
    if (this.showAiSettings) {
      const existingToken = this.settingsService.getHuggingFaceToken();
      this.hfToken = existingToken || '';
    }
  }

  saveHfToken(): void {
    if (!this.hfToken || !this.hfToken.startsWith('hf_')) {
      this.dialogService
        .error(
          'Please enter a valid Hugging Face token (starts with hf_)',
          'Invalid Token'
        )
        .subscribe();
      return;
    }

    this.isSavingToken = true;

    this.settingsService.saveHuggingFaceToken(this.hfToken).subscribe({
      next: () => {
        this.isGemmaConfigured = true;
        this.showAiSettings = false;
        this.hfToken = this.hfToken.substring(0, 10) + '...';
        this.dialogService
          .alert('Gemma AI has been configured! 🎉', 'AI Configured')
          .subscribe();
        this.isSavingToken = false;
      },
      error: (error) => {
        this.dialogService.error('Failed to save token.', 'Error').subscribe();
        this.isSavingToken = false;
      },
    });
  }

  clearHfToken(): void {
    this.settingsService.clearHuggingFaceToken().subscribe({
      next: () => {
        this.hfToken = '';
        this.isGemmaConfigured = false;
        this.dialogService
          .alert('Token has been removed.', 'Token Cleared')
          .subscribe();
      },
      error: (error) => {
        this.dialogService.error('Failed to clear token.', 'Error').subscribe();
      },
    });
  }

  // Helpers
  getUserInitials(user: User): string {
    const name = user.fullName || user.username || 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  getAvatarColor(user: User): string {
    const colors = [
      'bg-blue-600',
      'bg-purple-600',
      'bg-emerald-600',
      'bg-orange-600',
      'bg-pink-600',
      'bg-cyan-600',
    ];
    const name = user.username || 'U';
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  }

  getRoleBadgeClass(role: string): string {
    switch (role) {
      case 'super-admin':
        return 'role-super-admin';
      case 'admin':
        return 'role-admin';
      case 'editor':
        return 'role-editor';
      default:
        return 'role-user';
    }
  }

  getLastActive(user: User): string {
    // Placeholder - would need actual last active tracking
    return 'Recently';
  }
}
