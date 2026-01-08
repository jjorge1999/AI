import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaintenanceService } from '../../services/maintenance.service';

@Component({
  selector: 'app-maintenance',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './maintenance.component.html',
  styleUrl: './maintenance.component.css',
})
export class MaintenanceComponent {
  constructor(public maintenanceService: MaintenanceService) {}

  reloadPage(): void {
    window.location.reload();
  }
}
