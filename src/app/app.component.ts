import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
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
import { ReservationComponent } from './components/reservation/reservation.component';
import { DialogComponent } from './components/dialog/dialog.component';
import { LoadingComponent } from './components/loading/loading.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
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
    ReservationComponent,
    DialogComponent,
    LoadingComponent,
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
    | 'users' = 'home';
  isDarkTheme = false;
  isLoggedIn = false;
  userRole = '';
  isChatOpen = false;
  totalUnreadMessages = 0;
  showReservation = false;
  isVisionAid = false;

  // Sidebar state
  isSidebarCollapsed = false;
  isMobileSidebarOpen = false;
  userFullName = 'User';

  constructor(
    private inventoryService: InventoryService,
    private chatService: ChatService
  ) {
    // Check login status
    this.isLoggedIn = localStorage.getItem('jjm_logged_in') === 'true';
    if (this.isLoggedIn) {
      this.inventoryService.reloadData();
    }
    this.userRole = localStorage.getItem('jjm_role') || 'user';
    this.userFullName =
      localStorage.getItem('jjm_fullname') ||
      localStorage.getItem('jjm_username') ||
      'User';

    // Load theme preference from localStorage or System
    const savedTheme = localStorage.getItem('jjm_theme');
    if (savedTheme) {
      this.isDarkTheme = savedTheme === 'dark';
    } else {
      // Check system preference
      this.isDarkTheme =
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    this.applyTheme();

    // Load vision aid preference
    const savedVision = localStorage.getItem('jjm_vision_aid');
    this.isVisionAid = savedVision === 'true';
    this.applyVisionAid();

    // Load sidebar preference
    const savedCollapsed = localStorage.getItem('jjm_sidebar_collapsed');
    this.isSidebarCollapsed = savedCollapsed === 'true';

    // Expose service for migration
    (window as any).inventoryService = this.inventoryService;

    // Check URL hash for direct reservation link
    this.checkUrlForReservation();
  }

  private checkUrlForReservation(): void {
    const hash = window.location.hash;
    if (hash === '#/reservation' || hash === '#reservation') {
      this.showReservation = true;
    }
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

  toggleVisionAid(): void {
    this.isVisionAid = !this.isVisionAid;
    this.applyVisionAid();
    localStorage.setItem('jjm_vision_aid', String(this.isVisionAid));
  }

  private applyVisionAid(): void {
    if (this.isVisionAid) {
      document.body.classList.add('vision-aid');
    } else {
      document.body.classList.remove('vision-aid');
    }
  }

  logout(): void {
    this.chatService.triggerLogout();
    localStorage.removeItem('jjm_logged_in');
    localStorage.removeItem('jjm_username');
    localStorage.removeItem('jjm_user_id');
    localStorage.removeItem('jjm_role');
    localStorage.removeItem('jjm_fullname');
    localStorage.removeItem('chatCustomerInfo');
    localStorage.removeItem('chatUserName');
    this.isLoggedIn = false;
    window.location.reload();
  }

  private applyTheme(): void {
    const root = document.documentElement;
    if (this.isDarkTheme) {
      document.body.classList.add('dark-theme');
      root.classList.add('dark');
    } else {
      document.body.classList.remove('dark-theme');
      root.classList.remove('dark');
    }
  }

  toggleChat(): void {
    this.isChatOpen = !this.isChatOpen;
  }

  toggleReservation(): void {
    this.showReservation = !this.showReservation;

    // Update URL hash to reflect state
    if (this.showReservation) {
      window.location.hash = '#/reservation';
    } else {
      window.location.hash = '';
    }
  }

  getReservationLink(): string {
    return `${window.location.origin}${window.location.pathname}#/reservation`;
  }

  // Sidebar Methods
  toggleSidebarCollapse(): void {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
    localStorage.setItem(
      'jjm_sidebar_collapsed',
      String(this.isSidebarCollapsed)
    );
  }

  toggleMobileSidebar(): void {
    this.isMobileSidebarOpen = !this.isMobileSidebarOpen;
  }

  closeMobileSidebar(): void {
    this.isMobileSidebarOpen = false;
  }

  getUserInitials(): string {
    const name = this.userFullName || 'U';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  getPageTitle(): string {
    const titles: { [key: string]: string } = {
      home: 'Dashboard Overview',
      'add-product': 'Add Product',
      sell: 'Point of Sale',
      inventory: 'Inventory Management',
      customers: 'Customer Management',
      expenses: 'Expense Tracking',
      reports: 'Analytics & Reports',
      logs: 'Activity Logs',
      users: 'User Management',
    };
    return titles[this.activeTab] || 'Dashboard';
  }
}
