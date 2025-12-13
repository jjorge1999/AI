import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements OnInit, OnDestroy {
  username = '';
  password = '';
  errorMessage = '';
  isLoading = false;
  showPassword = false;

  constructor(private userService: UserService) {}

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    // Cleanup if needed
  }

  onLogin(): void {
    this.errorMessage = '';

    if (!this.username || !this.password) {
      this.errorMessage = 'Please enter both username and password';
      return;
    }

    this.isLoading = true;

    // Use UserService for authentication
    setTimeout(() => {
      this.userService
        .validateCredentials(this.username, this.password)
        .subscribe((user) => {
          if (user) {
            localStorage.setItem('jjm_logged_in', 'true');
            localStorage.setItem('jjm_username', this.username);
            localStorage.setItem('jjm_user_id', user.id); // Save User ID
            localStorage.setItem('jjm_role', user.role); // Save role
            localStorage.setItem(
              'jjm_fullname',
              user.fullName || this.username
            ); // Save full name for chat
            window.location.reload();
          } else {
            this.errorMessage = 'Invalid username or password';
            this.isLoading = false;
          }
        });
    }, 800);
  }
}
