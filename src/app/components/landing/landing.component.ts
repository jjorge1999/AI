import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css',
})
export class LandingComponent {
  features = [
    {
      icon: '📦',
      title: 'Smart Inventory',
      description:
        'Add, track, and manage your products with real-time stock updates.',
    },
    {
      icon: '💰',
      title: 'Advanced POS',
      description:
        'Seamless sales processing with pending delivery scheduling and alarms.',
    },
    {
      icon: '📞',
      title: 'Live Communication',
      description:
        'Real-time chat and crystal clear audio calls for instant support.',
    },
    {
      icon: '🌍',
      title: 'GPS Location',
      description:
        'Integrated location sharing for precise delivery coordination.',
    },
    {
      icon: '📊',
      title: 'Analytics & Reports',
      description:
        'Visualize income, expenses, and profit margins with detailed charts.',
    },
    {
      icon: '📋',
      title: 'Activity Logs',
      description:
        'Complete audit trail of all system actions for security and accountability.',
    },
    {
      icon: '👥',
      title: 'Customer CRM',
      description: 'Maintain detailed customer profiles and purchase history.',
    },
    {
      icon: '💸',
      title: 'Expense Tracking',
      description: 'Monitor operational costs to ensure maximum profitability.',
    },
  ];
}
