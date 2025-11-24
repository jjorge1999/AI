import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css'
})
export class LandingComponent {
  features = [
    {
      icon: '📦',
      title: 'Product Management',
      description: 'Add, track, and manage your inventory with ease'
    },
    {
      icon: '💰',
      title: 'Point of Sale',
      description: 'Quick and efficient sales processing with delivery scheduling'
    },
    {
      icon: '📊',
      title: 'Analytics & Reports',
      description: 'Track income, expenses, and profit margins in real-time'
    },
    {
      icon: '👥',
      title: 'Customer Management',
      description: 'Maintain customer records and delivery information'
    },
    {
      icon: '💸',
      title: 'Expense Tracking',
      description: 'Monitor business expenses and maintain financial records'
    },
    {
      icon: '🚚',
      title: 'Delivery Management',
      description: 'Schedule and track pending deliveries efficiently'
    }
  ];
}
