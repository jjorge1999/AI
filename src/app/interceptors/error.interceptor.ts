import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { MaintenanceService } from '../services/maintenance.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const maintenanceService = inject(MaintenanceService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (
        error.status === 429 ||
        (error.error && error.error.error === 'Firebase Quota Exhausted')
      ) {
        maintenanceService.setMaintenanceMode(
          true,
          'Firebase Quota Exhausted. System is in read-only maintenance mode.'
        );
      }
      return throwError(() => error);
    })
  );
};
