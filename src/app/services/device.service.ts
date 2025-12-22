import { Injectable, OnDestroy } from '@angular/core';
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
    return isMobile;
  }

  get isMobile(): boolean {
    return this.isMobileSubject.value;
  }

  ngOnDestroy() {
    if (this.resizeSubscription) {
      this.resizeSubscription.unsubscribe();
    }
  }
}
