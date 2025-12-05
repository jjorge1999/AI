import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserService } from '../../services/user.service';
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

  constructor(private userService: UserService) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  loadUsers(): void {
    this.isLoading = true;
    const currentUserId = localStorage.getItem('jjm_user_id');

    this.userService.getUsers().subscribe((users) => {
      // Filter to show only the logged-in user OR users created by them
      if (currentUserId) {
        this.users = users.filter(
          (u) =>
            u.id === currentUserId ||
            u.createdBy === currentUserId ||
            u.userId === currentUserId
        );
      } else {
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
      alert('Please fill in username and role.');
      return;
    }

    // Password validation
    if (!this.isEditing && !this.formPassword) {
      alert('Password is required for new users.');
      return;
    }

    if (this.isEditing && this.currentUser.id) {
      // Update logic
      const payload: Partial<User> & { id: string } = {
        id: this.currentUser.id,
        username: this.currentUser.username,
        fullName: this.currentUser.fullName,
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
      } as User;

      this.userService.addUser(newUser).subscribe(() => {
        this.closeModal();
      });
    }
  }

  deleteUser(userId: string): void {
    if (confirm('Are you sure you want to delete this user?')) {
      this.userService.deleteUser(userId).subscribe();
    }
  }
}
