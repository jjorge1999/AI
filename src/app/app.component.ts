import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  RouterOutlet,
  RouterModule,
  Router,
  NavigationEnd,
} from '@angular/router';
import { InventoryService } from './services/inventory.service';
import { ChatService } from './services/chat.service';
// ... components imports ...
import { DialogComponent } from './components/dialog/dialog.component';
import { LoadingComponent } from './components/loading/loading.component';
import { ChatComponent } from './components/chat/chat.component';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterModule,
    DialogComponent,
    LoadingComponent,
    ChatComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'JJM Inventory';
  activeTab = 'home';

  // POS State
  posInitialPending = false;

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

  private routerSub: Subscription = new Subscription();

  constructor(
    private inventoryService: InventoryService,
    private chatService: ChatService,
    private router: Router
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

    // Load theme preference
    const savedTheme = localStorage.getItem('jjm_theme');
    if (savedTheme) {
      this.isDarkTheme = savedTheme === 'dark';
    } else {
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

    // Subscribe to router events to update activeTab
    this.routerSub = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event: any) => {
        const url = event.urlAfterRedirects;
        if (url.includes('/home')) this.activeTab = 'home';
        else if (url.includes('/add-product')) this.activeTab = 'add-product';
        else if (url.includes('/sell')) this.activeTab = 'sell';
        else if (url.includes('/inventory')) this.activeTab = 'inventory';
        else if (url.includes('/customers')) this.activeTab = 'customers';
        else if (url.includes('/expenses')) this.activeTab = 'expenses';
        else if (url.includes('/reports')) this.activeTab = 'reports';
        else if (url.includes('/logs')) this.activeTab = 'logs';
        else if (url.includes('/users')) this.activeTab = 'users';
      });
  }

  private checkUrlForReservation(): void {
    const hash = window.location.hash;
    if (hash === '#/reservation' || hash === '#reservation') {
      this.showReservation = true;
    }
  }

  ngOnInit() {}

  ngOnDestroy() {
    if (this.routerSub) {
      this.routerSub.unsubscribe();
    }
  }

  // Helper for template conditional if needed, but we rely on activeTab update
  setActiveTab(tab: string): void {
    // This is primarily used by the template click handlers which we are replacing with routerLink for sidebar
    // But internal usages might navigate.
    // Ideally we navigate instead.
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
