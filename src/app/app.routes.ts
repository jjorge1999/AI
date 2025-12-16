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

// Admin guard function
const adminGuard = () => {
  const router = inject(Router);
  const isLoggedIn = localStorage.getItem('jjm_logged_in') === 'true';
  const role = localStorage.getItem('jjm_role');

  if (!isLoggedIn || role !== 'admin') {
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
  },
  {
    path: 'reservation',
    loadComponent: () =>
      import('./components/reservation/reservation.component').then(
        (m) => m.ReservationComponent
      ),
  },
  {
    path: 'play',
    loadComponent: () =>
      import('./components/color-game/color-game.component').then(
        (m) => m.ColorGameComponent
      ),
  },

  // Protected routes (require login)
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
      },
      {
        path: 'add-product',
        loadComponent: () =>
          import('./components/product-form/product-form.component').then(
            (m) => m.ProductFormComponent
          ),
      },
      {
        path: 'sell',
        loadComponent: () =>
          import('./components/pos-calculator/pos-calculator.component').then(
            (m) => m.PosCalculatorComponent
          ),
      },
      {
        path: 'inventory',
        loadComponent: () =>
          import('./components/inventory-list/inventory-list.component').then(
            (m) => m.InventoryListComponent
          ),
      },
      {
        path: 'customers',
        loadComponent: () =>
          import('./components/customer-form/customer-form.component').then(
            (m) => m.CustomerFormComponent
          ),
      },
      {
        path: 'expenses',
        loadComponent: () =>
          import('./components/expenses/expenses.component').then(
            (m) => m.ExpensesComponent
          ),
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./components/reports/reports.component').then(
            (m) => m.ReportsComponent
          ),
      },
      {
        path: 'logs',
        loadComponent: () =>
          import('./components/activity-logs/activity-logs.component').then(
            (m) => m.ActivityLogsComponent
          ),
      },
      {
        path: 'users',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./components/user-management/user-management.component').then(
            (m) => m.UserManagementComponent
          ),
      },
      {
        path: 'sales',
        loadComponent: () =>
          import(
            './components/sales-management/sales-management.component'
          ).then((m) => m.SalesManagementComponent),
      },
    ],
  },

  // Fallback route
  {
    path: '**',
    redirectTo: 'login',
  },
];
