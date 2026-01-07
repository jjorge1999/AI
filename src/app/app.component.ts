import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  RouterOutlet,
  RouterModule,
  Router,
  NavigationEnd,
} from '@angular/router';
import { FormsModule } from '@angular/forms';
import { UserService } from './services/user.service';
import { InventoryService } from './services/inventory.service';
import { ChatService } from './services/chat.service';
import { StoreService } from './services/store.service';
import { Store, User } from './models/inventory.models';
import { DialogComponent } from './components/dialog/dialog.component';
import { LoadingComponent } from './components/loading/loading.component';
import { ChatComponent } from './components/chat/chat.component';
import { Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import {
  NotificationService,
  AdminNotification,
} from './services/notification.service';
import { DialogService } from './services/dialog.service';
import { DeviceService } from './services/device.service';
import { Sale } from './models/inventory.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterModule,
    FormsModule,
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
  notificationCount = 0;
  recentNotifications: AdminNotification[] = [];
  showNotifications = false;
  showReservation = false;
  isVisionAid = false;
  isLoginPage = false;
  isReservationPage = false;

  // Store state
  stores: Store[] = [];
  activeStoreId: string | null = null;
  activeStoreName = 'Select Store';

  isSidebarCollapsed = false;
  isMobileSidebarOpen = false;
  userFullName = 'User';
  currentUser: User | null = null;
  allowedStores: Store[] = [];

  private routerSub: Subscription = new Subscription();

  constructor(
    private inventoryService: InventoryService,
    private chatService: ChatService,
    private userService: UserService,
    private notificationService: NotificationService,
    private dialogService: DialogService,
    private deviceService: DeviceService,
    private storeService: StoreService,
    private router: Router,
    private ngZone: NgZone
  ) {
    // Check login status via service for reactivity
    this.userService.isLoggedIn$.subscribe((loggedIn) => {
      this.isLoggedIn = loggedIn;
      if (this.isLoggedIn) {
        // Refresh user info from localStorage after login
        this.userRole = localStorage.getItem('jjm_role') || 'user';
        this.userFullName =
          localStorage.getItem('jjm_fullname') ||
          localStorage.getItem('jjm_username') ||
          'User';
        this.inventoryService.reloadData();

        // FCM Setup
        this.notificationService.requestPermission();
        this.notificationService.listenForMessages();

        // Check delivery reminders on login
        this.checkDeliveryReminders();

        // Load stores
        this.storeService.loadStores();
        this.userService.loadUsers();
      }
    });

    this.userService.currentUser$.subscribe((user) => {
      this.currentUser = user;
      if (user?.role) {
        this.userRole = user.role;
      }
      this.filterAllowedStores();
    });

    this.storeService.stores$.subscribe((stores) => {
      this.stores = stores;
      this.filterAllowedStores();
      this.updateActiveStoreName();
    });

    this.storeService.activeStoreId$.subscribe((id) => {
      this.activeStoreId = id;
      this.updateActiveStoreName();
    });

    this.notificationService.notificationCount$.subscribe((count) => {
      this.notificationCount = count;
    });

    this.notificationService.notifications$.subscribe((notifs) => {
      this.recentNotifications = notifs;
    });

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

    // Load sidebar preference - respects user preference on all devices
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
        this.isLoginPage = url.includes('/login');
        this.isReservationPage = url.includes('/reservation');
        if (url.includes('/home')) this.activeTab = 'home';
        else if (url.includes('/add-product')) this.activeTab = 'add-product';
        else if (url.includes('/sell')) this.activeTab = 'sell';
        else if (url.includes('/inventory')) this.activeTab = 'inventory';
        else if (url.includes('/customers')) this.activeTab = 'customers';
        else if (url.includes('/expenses')) this.activeTab = 'expenses';
        else if (url.includes('/reports')) this.activeTab = 'reports';
        else if (url.includes('/logs')) this.activeTab = 'logs';
        else if (url.includes('/users')) this.activeTab = 'users';
        else if (url.includes('/sales')) this.activeTab = 'sales';
        else if (url.includes('/ads')) this.activeTab = 'ads';
        else if (url.includes('/stores')) this.activeTab = 'stores';
      });
  }

  private checkUrlForReservation(): void {
    const hash = window.location.hash;
    if (hash === '#/reservation' || hash === '#reservation') {
      this.showReservation = true;
    }
  }

  ngOnInit() {
    // Listen for openChatBubble event from child components
    window.addEventListener('openChatBubble', this.onOpenChatBubble.bind(this));
  }

  private onOpenChatBubble = (): void => {
    this.ngZone.run(() => {
      this.isChatOpen = true;
      console.log('AppComponent: Chat opened via event');
    });
  };

  ngOnDestroy() {
    if (this.routerSub) {
      this.routerSub.unsubscribe();
    }
    // Remove event listener
    window.removeEventListener(
      'openChatBubble',
      this.onOpenChatBubble.bind(this)
    );
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

  toggleNotifications(event: MouseEvent): void {
    event.stopPropagation();
    this.showNotifications = !this.showNotifications;
    if (this.showNotifications) {
      this.notificationService.resetNotificationCount();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    this.showNotifications = false;
  }

  clearNotifications(): void {
    this.notificationService.clearNotifications();
    this.showNotifications = false;
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

    // Update service state
    this.userService.setLoginState(false);
    this.isLoggedIn = false;

    // Navigate to login
    this.router.navigate(['/login']);
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

  // Store methods
  onStoreChange(storeId: string): void {
    if (!this.canSwitchToStore(storeId)) {
      this.dialogService.error(
        'Access Denied: You are not assigned to this store branch.',
        'Permission Restricted'
      );
      return;
    }
    this.storeService.setActiveStore(storeId);
    this.inventoryService.reloadData();
    this.dialogService.success('Switched to ' + this.activeStoreName);
  }

  private filterAllowedStores(): void {
    if (!this.currentUser) {
      this.allowedStores = [];
      return;
    }

    if (this.currentUser.role === 'super-admin') {
      this.allowedStores = this.stores;
    } else {
      const authorizedIds = this.currentUser.storeIds || [];
      const primaryId = this.currentUser.storeId;
      this.allowedStores = this.stores.filter(
        (s) =>
          (authorizedIds.includes(s.id) || s.id === primaryId) &&
          !s.isSuperAdminOnly
      );
    }

    // ENFORCE STORE ISOLATION:
    // If the active store is no longer allowed (or hasn't been set yet),
    // reset it to the first authorized store.
    if (this.allowedStores.length > 0) {
      const isCurrentlyAllowed = this.allowedStores.some(
        (s) => s.id === this.activeStoreId
      );
      if (!this.activeStoreId || !isCurrentlyAllowed) {
        console.log(
          'Enforcing store isolation: Switching to first authorized branch.'
        );
        // Don't use onStoreChange here as it has dialogs/reloads that might conflict with current observable cycle
        const defaultStoreId = this.allowedStores[0].id;
        this.storeService.setActiveStore(defaultStoreId);
        // Important: reload data because activeStoreId has changed
        this.inventoryService.reloadData();
      }
    } else if (this.currentUser.role !== 'super-admin') {
      // If NOT a super-admin and has NO assigned stores, clear the active store
      this.storeService.setActiveStore(null);
      this.inventoryService.reloadData();
    }

    this.updateActiveStoreName();
  }

  canSwitchToStore(storeId: string): boolean {
    if (!this.currentUser) return false;
    if (this.currentUser.role === 'super-admin') return true;

    const store = this.stores.find((s) => s.id === storeId);
    if (store?.isSuperAdminOnly) return false;

    const authorizedIds = this.currentUser.storeIds || [];
    return (
      authorizedIds.includes(storeId) || this.currentUser.storeId === storeId
    );
  }

  private updateActiveStoreName(): void {
    if (this.activeStoreId) {
      const store = this.stores.find((s) => s.id === this.activeStoreId);
      this.activeStoreName = store ? store.name : 'Select Store';
    } else {
      this.activeStoreName = 'Select Store';
    }
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
      sales: 'Sales & Promotions',
      ads: 'Ad Inventory',
      stores: 'Store Management',
    };
    return titles[this.activeTab] || 'Dashboard';
  }

  private checkDeliveryReminders(): void {
    // Wait for sales data to be loaded (not empty) then check
    this.inventoryService
      .getSales()
      .pipe(
        filter((sales) => sales && sales.length > 0),
        take(1)
      )
      .subscribe((sales: Sale[]) => {
        console.log('AppComponent: Sales data received, length:', sales.length);
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        // Filter only pending sales with delivery dates
        const pendingSales = sales.filter(
          (s) =>
            s.deliveryDate &&
            (s.pending === true || (s as any).pending === 'true')
        );

        console.log(
          'AppComponent: Found',
          pendingSales.length,
          'pending sales with delivery dates'
        );

        pendingSales.forEach((sale: Sale) => {
          if (!sale.deliveryDate) return;

          const delivery = new Date(sale.deliveryDate);
          const diffMs = delivery.getTime() - now.getTime();
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

          console.log(
            `AppComponent: Checking "${sale.productName}", diffDays: ${diffDays}, pending: ${sale.pending}`
          );

          // Trigger for Today (0), Tomorrow (1), Upcoming (2), or Overdue (<0)
          if (diffDays <= 2) {
            this.notifyDeliveryReminder(sale, diffDays);
          }
        });
      });
  }

  private notifyDeliveryReminder(sale: Sale, daysAhead: number): void {
    const delivery = new Date(sale.deliveryDate!);
    const dateStr = delivery.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    let title: string;
    let message: string;
    let type: AdminNotification['type'] = 'reminder';

    if (daysAhead < 0) {
      title = 'Overdue Delivery 🚨';
      message = `Delivery for "${sale.productName}" is OVERDUE by ${Math.abs(
        daysAhead
      )} day(s) (was due ${dateStr}).`;
    } else if (daysAhead === 0) {
      title = 'Delivery Due Today 🚚';
      message = `Delivery for "${sale.productName}" is due TODAY (${dateStr}).`;
    } else {
      title = 'Upcoming Delivery 🚚';
      message = `Delivery for "${sale.productName}" is due in ${daysAhead} day(s) (${dateStr}).`;
    }

    // 1. Add to the new notification UI
    const isNew = this.notificationService.pushNotification(
      title,
      message,
      'reminder'
    );

    // 2. Play alert sound ONLY if it's a new notification
    if (isNew) {
      this.playReminderSound();

      // 3. Optional: Show a dialog if it's super critical (overdue)
      if (daysAhead < 0) {
        this.dialogService.alert(message, title, 'warning');
      }
    }
  }

  private playReminderSound(): void {
    try {
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + 0.5
      );

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
      console.warn('Could not play reminder sound:', e);
    }
  }
}
