import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoadingService } from '../../services/loading.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-loading',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './loading.component.html',
  styleUrl: './loading.component.css',
})
export class LoadingComponent implements OnInit, OnDestroy {
  isLoading = false;
  message = 'Loading...';
  private subscriptions: Subscription[] = [];

  constructor(private loadingService: LoadingService) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.loadingService.loading$.subscribe((loading) => {
        this.isLoading = loading;
      })
    );

    this.subscriptions.push(
      this.loadingService.message$.subscribe((message) => {
        this.message = message;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }
}
