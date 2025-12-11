import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserService } from '../../services/user.service';
import { DialogService } from '../../services/dialog.service';
import { SettingsService } from '../../services/settings.service';
import { User } from '../../models/inventory.models';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.css',
})
export class UserManagementComponent implements OnInit {
  users: User[] = [];
  isLoading = false;

  // Modal state
  isModalOpen = false;
  isEditing = false;

  currentUser: Partial<User> = {
    username: '',
    fullName: '',
    role: 'user',
  };
  formPassword = ''; // Separate variable for form input

  // AI Settings
  hfToken = '';
  isGemmaConfigured = false;
  showAiSettings = false;
  isSavingToken = false;

  constructor(
    private userService: UserService,
    private dialogService: DialogService,
    private settingsService: SettingsService
  ) {}

  ngOnInit(): void {
    // 1. Subscribe to the stream
    this.loadUsers();
    // 2. Trigger the fetch from backend
    this.userService.loadUsers();
    // 3. Check if Gemma is configured
    this.checkGemmaStatus();

    // 4. Subscribe to settings changes (realtime sync from Firebase)
    this.settingsService.getSettings().subscribe((settings) => {
      this.isGemmaConfigured = this.settingsService.isGemmaConfigured();
      if (settings.huggingFaceToken && !this.showAiSettings) {
        this.hfToken = settings.huggingFaceToken.substring(0, 10) + '...';
      }
    });
  }

  checkGemmaStatus(): void {
    this.isGemmaConfigured = this.settingsService.isGemmaConfigured();
    // Load existing token for display (masked)
    const existingToken = this.settingsService.getHuggingFaceToken();
    if (existingToken) {
      this.hfToken = existingToken.substring(0, 10) + '...';
    }
  }

  toggleAiSettings(): void {
    this.showAiSettings = !this.showAiSettings;
    if (this.showAiSettings) {
      // Clear the masked display when editing
      const existingToken = this.settingsService.getHuggingFaceToken();
      this.hfToken = existingToken || '';
    }
  }

  async saveHfToken(): Promise<void> {
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

    try {
      await this.settingsService.saveHuggingFaceToken(this.hfToken);
      this.isGemmaConfigured = true;
      this.showAiSettings = false;
      this.hfToken = this.hfToken.substring(0, 10) + '...';

      this.dialogService
        .alert(
          'Gemma AI has been configured and saved to database! 🎉 All devices will now use this token.',
          'AI Configured'
        )
        .subscribe();
    } catch (error) {
      this.dialogService
        .error(
          'Failed to save to database, but token saved locally.',
          'Partial Save'
        )
        .subscribe();
    } finally {
      this.isSavingToken = false;
    }
  }

  async clearHfToken(): Promise<void> {
    try {
      await this.settingsService.clearHuggingFaceToken();
      this.hfToken = '';
      this.isGemmaConfigured = false;
      this.dialogService
        .alert(
          'Hugging Face token has been removed from all devices.',
          'Token Cleared'
        )
        .subscribe();
    } catch (error) {
      this.dialogService
        .error('Failed to clear token from database.', 'Error')
        .subscribe();
    }
  }

  loadUsers(): void {
    this.isLoading = true;
    const currentUserId = localStorage.getItem('jjm_user_id');

    this.userService.getUsers().subscribe((users) => {
      // Filter to show:
      // 1. The logged-in user themselves
      // 2. Users created by the logged-in user (userId === currentUserId)
      if (currentUserId && currentUserId !== 'admin') {
        // If generic admin, show all?
        // Assuming 'admin' role check is better, but here we check ID
        this.users = users.filter(
          (u) => u.id === currentUserId || u.userId === currentUserId
        );
      } else {
        // If no ID (or super admin), show all
        this.users = users;
      }
      this.isLoading = false;
    });
  }

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
    this.formPassword = ''; // Reset password field
    this.currentUser = { ...user }; // Copy user details
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

    // Password validation
    if (!this.isEditing && !this.formPassword) {
      this.dialogService
        .error('Password is required for new users.', 'Validation Error')
        .subscribe();
      return;
    }

    if (this.isEditing && this.currentUser.id) {
      // Update logic
      const payload: Partial<User> & { id: string } = {
        id: this.currentUser.id,
        username: this.currentUser.username,
        fullName: this.currentUser.fullName,
        address: this.currentUser.address,
        gpsCoordinates: this.currentUser.gpsCoordinates,
        role: this.currentUser.role,
      };

      // Only include password if changed
      if (this.formPassword) {
        payload.password = this.formPassword;
      }

      this.userService.updateUser(payload).subscribe(() => {
        this.closeModal();
      });
    } else {
      // Create logic
      const currentUserId = localStorage.getItem('jjm_user_id') || 'system';
      const newUser = {
        ...this.currentUser,
        password: this.formPassword,
        createdBy: currentUserId,
        userId: currentUserId,
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
}
