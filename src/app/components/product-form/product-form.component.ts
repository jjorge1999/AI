import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './product-form.component.html',
  styleUrl: './product-form.component.css',
})
export class ProductFormComponent {
  product = {
    name: '',
    category: '',
    price: 0,
    quantity: 0,
    imageUrl: '',
  };

  imagePreview: string | null = null;

  constructor(private inventoryService: InventoryService) {}

  onImageChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];

      // Limit raw file size check (e.g. 10MB limit before trying to process)
      if (file.size > 10 * 1024 * 1024) {
        alert('File is too large. Please select an image under 10MB.');
        return;
      }

      const reader = new FileReader();

      reader.onload = (e: ProgressEvent<FileReader>) => {
        const img = new Image();
        img.src = e.target?.result as string;

        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Resize logic: Max dimension 800px
          const maxDim = 800;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            // Compress to JPEG with 0.7 quality
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

            this.imagePreview = dataUrl;
            this.product.imageUrl = dataUrl;
          }
        };
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
        imageUrl: this.product.imageUrl,
      });

      // Reset form
      this.product = {
        name: '',
        category: '',
        price: 0,
        quantity: 0,
        imageUrl: '',
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
