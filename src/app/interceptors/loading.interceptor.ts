import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs/operators';
import { LoadingService } from '../services/loading.service';

let activeRequests = 0;

export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  const loadingService = inject(LoadingService);

  // Increment active requests and show loading
  activeRequests++;
  if (activeRequests === 1) {
    loadingService.show('Loading...');
  }

  return next(req).pipe(
    finalize(() => {
      // Decrement active requests
      activeRequests--;

      // Hide loading only when all requests are complete
      if (activeRequests === 0) {
        loadingService.hide();
      }
    })
  );
};
