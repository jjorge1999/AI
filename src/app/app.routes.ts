import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';

// Auth guard function
const authGuard = () => {
  const router = inject(Router);
  const isLoggedIn = localStorage.getItem('jjm_logged_in') === 'true';

  if (!isLoggedIn) {
    return router.createUrlTree(['/login']);
  }
  return true;
};

// Admin guard function (allows admin or super-admin)
const adminGuard = () => {
  const router = inject(Router);
  const isLoggedIn = localStorage.getItem('jjm_logged_in') === 'true';
  const role = localStorage.getItem('jjm_role');

  if (!isLoggedIn || (role !== 'admin' && role !== 'super-admin')) {
    router.navigate(['/']);
    return false;
  }
  return true;
};

// Super Admin guard function (strictly super-admin)
const superAdminGuard = () => {
  const router = inject(Router);
  const isLoggedIn = localStorage.getItem('jjm_logged_in') === 'true';
  const role = localStorage.getItem('jjm_role');

  if (!isLoggedIn || role !== 'super-admin') {
    router.navigate(['/']);
    return false;
  }
  return true;
};

// Public guard - prevents logged-in users from accessing public pages
const publicGuard = () => {
  const router = inject(Router);
  const isLoggedIn = localStorage.getItem('jjm_logged_in') === 'true';

  if (isLoggedIn) {
    return router.createUrlTree(['/home']);
  }
  return true;
};

export const routes: Routes = [
  // Public routes (logged-in users redirected to home)
  {
    path: 'login',
    canActivate: [publicGuard],
    loadComponent: () =>
      import('./components/login/login.component').then(
        (m) => m.LoginComponent
      ),
    data: { breadcrumb: 'Login' },
  },
  {
    path: 'reservation',
    loadComponent: () =>
      import('./components/reservation/reservation.component').then(
        (m) => m.ReservationComponent
      ),
    data: { breadcrumb: 'Reservation' },
  },
  {
    path: 'play',
    loadComponent: () =>
      import('./components/color-game/color-game.component').then(
        (m) => m.ColorGameComponent
      ),
    data: { breadcrumb: 'Color Game' },
  },

  // Protected routes (require login)
  {
    path: 'pricing',
    loadComponent: () =>
      import(
        './components/subscription-pricing/subscription-pricing.component'
      ).then((m) => m.SubscriptionPricingComponent),
    data: { breadcrumb: 'Pricing' },
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full',
      },
      {
        path: 'home',
        loadComponent: () =>
          import('./components/landing/landing.component').then(
            (m) => m.LandingComponent
          ),
        data: { breadcrumb: 'Home' },
      },
      {
        path: 'add-product',
        loadComponent: () =>
          import('./components/product-form/product-form.component').then(
            (m) => m.ProductFormComponent
          ),
        data: { breadcrumb: 'Add Product' },
      },
      {
        path: 'sell',
        loadComponent: () =>
          import('./components/pos-calculator/pos-calculator.component').then(
            (m) => m.PosCalculatorComponent
          ),
        data: { breadcrumb: 'Point of Sale' },
      },
      {
        path: 'inventory',
        loadComponent: () =>
          import('./components/inventory-list/inventory-list.component').then(
            (m) => m.InventoryListComponent
          ),
        data: { breadcrumb: 'Inventory' },
      },
      {
        path: 'customers',
        loadComponent: () =>
          import('./components/customer-form/customer-form.component').then(
            (m) => m.CustomerFormComponent
          ),
        data: { breadcrumb: 'Customers' },
      },
      {
        path: 'expenses',
        loadComponent: () =>
          import('./components/expenses/expenses.component').then(
            (m) => m.ExpensesComponent
          ),
        data: { breadcrumb: 'Expenses' },
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./components/reports/reports.component').then(
            (m) => m.ReportsComponent
          ),
        data: { breadcrumb: 'Analytics' },
      },
      {
        path: 'logs',
        loadComponent: () =>
          import('./components/activity-logs/activity-logs.component').then(
            (m) => m.ActivityLogsComponent
          ),
        data: { breadcrumb: 'Activity Logs' },
      },
      {
        path: 'users',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./components/user-management/user-management.component').then(
            (m) => m.UserManagementComponent
          ),
        data: { breadcrumb: 'Users' },
      },
      {
        path: 'sales',
        loadComponent: () =>
          import(
            './components/sales-management/sales-management.component'
          ).then((m) => m.SalesManagementComponent),
        data: { breadcrumb: 'Sales & Promos' },
      },
      {
        path: 'ads',
        loadComponent: () =>
          import('./components/ads-management/ads-management.component').then(
            (m) => m.AdsManagementComponent
          ),
        data: { breadcrumb: 'Ad Inventory' },
      },
      {
        path: 'stores',
        canActivate: [adminGuard],
        loadComponent: () =>
          import(
            './components/store-management/store-management.component'
          ).then((m) => m.StoreManagementComponent),
        data: { breadcrumb: 'Stores' },
      },
    ],
  },

  // Fallback route
  {
    path: '**',
    redirectTo: 'login',
  },
];
