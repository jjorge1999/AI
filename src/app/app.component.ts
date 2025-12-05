import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InventoryService } from './services/inventory.service';
import { ChatService } from './services/chat.service';
import { ProductFormComponent } from './components/product-form/product-form.component';
import { PosCalculatorComponent } from './components/pos-calculator/pos-calculator.component';
import { InventoryListComponent } from './components/inventory-list/inventory-list.component';
import { CustomerFormComponent } from './components/customer-form/customer-form.component';
import { ExpensesComponent } from './components/expenses/expenses.component';
import { ReportsComponent } from './components/reports/reports.component';
import { LandingComponent } from './components/landing/landing.component';
import { LoginComponent } from './components/login/login.component';
import { ActivityLogsComponent } from './components/activity-logs/activity-logs.component';
import { ChatComponent } from './components/chat/chat.component';
import { UserManagementComponent } from './components/user-management/user-management.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    ProductFormComponent,
    PosCalculatorComponent,
    InventoryListComponent,
    CustomerFormComponent,
    ExpensesComponent,
    ReportsComponent,
    LandingComponent,
    LoginComponent,
    ActivityLogsComponent,
    ChatComponent,
    UserManagementComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  title = 'JJM Inventory';
  activeTab:
    | 'home'
    | 'add-product'
    | 'sell'
    | 'inventory'
    | 'customers'
    | 'expenses'
    | 'reports'
    | 'reports'
    | 'logs'
    | 'chat'
    | 'users' = 'home';
  isDarkTheme = false;
  isLoggedIn = false;
  userRole = '';
  isChatOpen = false;

  constructor(
    private inventoryService: InventoryService,
    private chatService: ChatService
  ) {
    // Check login status
    this.isLoggedIn = localStorage.getItem('jjm_logged_in') === 'true';
    this.userRole = localStorage.getItem('jjm_role') || 'user';

    // Load theme preference from localStorage
    const savedTheme = localStorage.getItem('jjm_theme');
    this.isDarkTheme = savedTheme === 'dark';
    this.applyTheme();

    // Expose service for migration
    (window as any).inventoryService = this.inventoryService;
  }

  setActiveTab(
    tab:
      | 'home'
      | 'add-product'
      | 'sell'
      | 'inventory'
      | 'customers'
      | 'expenses'
      | 'reports'
      | 'logs'
      | 'logs'
      | 'chat'
      | 'users'
  ): void {
    if (tab === 'users' && this.userRole !== 'admin') {
      return;
    }
    this.activeTab = tab;
  }

  toggleTheme(): void {
    this.isDarkTheme = !this.isDarkTheme;
    this.applyTheme();
    localStorage.setItem('jjm_theme', this.isDarkTheme ? 'dark' : 'light');
  }

  logout(): void {
    this.chatService.triggerLogout();
    localStorage.removeItem('jjm_logged_in');
    localStorage.removeItem('jjm_username');
    localStorage.removeItem('jjm_user_id');
    localStorage.removeItem('jjm_role');
    localStorage.removeItem('chatCustomerInfo');
    localStorage.removeItem('chatUserName');
    this.isLoggedIn = false;
    window.location.reload();
  }

  private applyTheme(): void {
    if (this.isDarkTheme) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }

  toggleChat(): void {
    this.isChatOpen = !this.isChatOpen;
  }
}
