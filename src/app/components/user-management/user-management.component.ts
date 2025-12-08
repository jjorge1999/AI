import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserService } from '../../services/user.service';
import { DialogService } from '../../services/dialog.service';
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

  constructor(
    private userService: UserService,
    private dialogService: DialogService
  ) {}

  ngOnInit(): void {
    // 1. Subscribe to the stream
    this.loadUsers();
    // 2. Trigger the fetch from backend
    this.userService.loadUsers();
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

  async saveUser(): Promise<void> {
    if (!this.currentUser.username || !this.currentUser.role) {
      await this.dialogService.error(
        'Please fill in username and role.',
        'Validation Error'
      );
      return;
    }

    // Password validation
    if (!this.isEditing && !this.formPassword) {
      await this.dialogService.error(
        'Password is required for new users.',
        'Validation Error'
      );
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

  async deleteUser(userId: string): Promise<void> {
    if (
      await this.dialogService.confirm(
        'Are you sure you want to delete this user?',
        'Delete User'
      )
    ) {
      this.userService.deleteUser(userId).subscribe();
    }
  }
}
