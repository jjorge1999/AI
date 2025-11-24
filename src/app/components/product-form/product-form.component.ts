import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './product-form.component.html',
  styleUrl: './product-form.component.css'
})
export class ProductFormComponent {
  product = {
    name: '',
    category: '',
    price: 0,
    quantity: 0,
    imageUrl: ''
  };

  imagePreview: string | null = null;

  constructor(private inventoryService: InventoryService) {}

  onImageChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      
      reader.onload = (e: ProgressEvent<FileReader>) => {
        this.imagePreview = e.target?.result as string;
        this.product.imageUrl = e.target?.result as string;
      };
      
      reader.readAsDataURL(file);
    }
  }

  removeImage(): void {
    this.imagePreview = null;
    this.product.imageUrl = '';
  }

  onSubmit(): void {
    if (this.isValid()) {
      this.inventoryService.addProduct({
        name: this.product.name,
        category: this.product.category,
        price: this.product.price,
        quantity: this.product.quantity,
        imageUrl: this.product.imageUrl
      });

      // Reset form
      this.product = {
        name: '',
        category: '',
        price: 0,
        quantity: 0,
        imageUrl: ''
      };
      this.imagePreview = null;
    }
  }

  isValid(): boolean {
    return !!(
      this.product.name &&
      this.product.category &&
      this.product.price > 0 &&
      this.product.quantity > 0
    );
  }
}
