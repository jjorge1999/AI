# Loading Overlay Indicator - Usage Guide

## Overview

The loading overlay provides a global loading indicator that can be shown/hidden from any component in the application.

## Basic Usage

### Import the Service

```typescript
import { LoadingService } from './services/loading.service';

constructor(private loadingService: LoadingService) {}
```

## Methods

### Show Loading

```typescript
// Show with default message
this.loadingService.show();

// Show with custom message
this.loadingService.show("Saving data...");
this.loadingService.show("Loading products...");
this.loadingService.show("Processing payment...");
```

### Hide Loading

```typescript
this.loadingService.hide();
```

## Common Usage Patterns

### 1. Async Operations

```typescript
async saveData() {
  this.loadingService.show('Saving...');

  try {
    await this.dataService.save(this.data);
    // Success
  } catch (error) {
    // Handle error
  } finally {
    this.loadingService.hide();
  }
}
```

### 2. HTTP Requests

```typescript
loadProducts() {
  this.loadingService.show('Loading products...');

  this.productService.getProducts().subscribe({
    next: (products) => {
      this.products = products;
      this.loadingService.hide();
    },
    error: (error) => {
      console.error(error);
      this.loadingService.hide();
    }
  });
}
```

### 3. Multiple Steps

```typescript
async processOrder() {
  this.loadingService.show('Validating order...');
  await this.validateOrder();

  this.loadingService.show('Processing payment...');
  await this.processPayment();

  this.loadingService.show('Updating inventory...');
  await this.updateInventory();

  this.loadingService.hide();
}
```

### 4. Promise-based

```typescript
submitForm() {
  this.loadingService.show('Submitting...');

  this.apiService.submit(this.formData)
    .then(response => {
      // Handle success
    })
    .catch(error => {
      // Handle error
    })
    .finally(() => {
      this.loadingService.hide();
    });
}
```

## Features

✅ **Global Overlay** - Covers entire screen  
✅ **Blocks Interaction** - Prevents clicks while loading  
✅ **Animated Spinner** - Smooth rotating animation  
✅ **Custom Messages** - Show context-specific messages  
✅ **Glass Effect** - Blurred backdrop for modern look  
✅ **Theme Compatible** - Works with light and dark modes  
✅ **Auto-dismiss Safe** - Won't crash if hidden multiple times

## Styling

The loading indicator uses:

- **Primary color** for spinner
- **Smooth animations** (fade in, slide up, rotation)
- **Backdrop blur** for glassmorphism effect
- **Semi-transparent overlay** (70% opacity)
- **High z-index** (9999) to appear above everything

## Example Messages

```typescript
// Data operations
this.loadingService.show("Loading...");
this.loadingService.show("Saving changes...");
this.loadingService.show("Deleting item...");
this.loadingService.show("Updating...");

// File operations
this.loadingService.show("Uploading file...");
this.loadingService.show("Processing image...");
this.loadingService.show("Generating report...");

// Network operations
this.loadingService.show("Connecting...");
this.loadingService.show("Syncing data...");
this.loadingService.show("Fetching updates...");

// User actions
this.loadingService.show("Please wait...");
this.loadingService.show("Processing request...");
this.loadingService.show("Logging in...");
```

## Tips

1. **Always hide**: Make sure to call `hide()` in `finally` blocks
2. **Clear messages**: Use short, specific messages
3. **User feedback**: Show appropriate messages for context
4. **Error handling**: Hide loading even on errors
5. **Avoid nesting**: Don't show multiple loading overlays
6. **Performance**: Use for operations > 500ms

## Component Example

```typescript
import { Component } from "@angular/core";
import { LoadingService } from "./services/loading.service";

@Component({
  selector: "app-example",
  template: `
    <button (click)="loadData()">Load Data</button>
    <button (click)="saveData()">Save Data</button>
  `,
})
export class ExampleComponent {
  constructor(private loadingService: LoadingService) {}

  async loadData() {
    this.loadingService.show("Loading data...");

    try {
      // Simulate API call
      await this.delay(2000);
      console.log("Data loaded!");
    } finally {
      this.loadingService.hide();
    }
  }

  async saveData() {
    this.loadingService.show("Saving...");

    try {
      await this.delay(1500);
      console.log("Data saved!");
    } catch (error) {
      console.error("Save failed:", error);
    } finally {
      this.loadingService.hide();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

## Integration with Other Services

Can be used together with DialogService:

```typescript
async deleteItem() {
  const confirmed = await this.dialogService.confirm(
    'Delete this item?',
    'Confirm Delete'
  );

  if (confirmed) {
    this.loadingService.show('Deleting...');

    try {
      await this.itemService.delete(itemId);
      await this.dialogService.success('Item deleted successfully!');
    } catch (error) {
      await this.dialogService.error('Failed to delete item');
    } finally {
      this.loadingService.hide();
    }
  }
}
```
