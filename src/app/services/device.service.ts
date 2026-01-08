import { Injectable, OnDestroy, signal, computed } from '@angular/core';
import { BehaviorSubject, fromEvent, Subscription } from 'rxjs';
import {
  debounceTime,
  distinctUntilChanged,
  map,
  startWith,
} from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class DeviceService implements OnDestroy {
  private isMobileSubject = new BehaviorSubject<boolean>(false);
  public isMobile$ = this.isMobileSubject.pipe(distinctUntilChanged());

  // Signal version
  private _isMobile = signal<boolean>(false);
  public isMobile = this._isMobile.asReadonly();

  private resizeSubscription: Subscription;

  constructor() {
    this.checkMobile();
    this.resizeSubscription = fromEvent(window, 'resize')
      .pipe(
        debounceTime(100),
        map(() => this.checkMobile()),
        startWith(this.checkMobile())
      )
      .subscribe();
  }

  private checkMobile(): boolean {
    const isMobile = window.innerWidth <= 768; // Standard tablet/mobile breakpoint
    this.isMobileSubject.next(isMobile);
    this._isMobile.set(isMobile);
    return isMobile;
  }

  ngOnDestroy() {
    if (this.resizeSubscription) {
      this.resizeSubscription.unsubscribe();
    }
  }
}
