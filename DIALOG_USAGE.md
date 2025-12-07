# Custom Dialog System - Usage Guide

## Overview

The custom dialog system replaces native `alert()` and `confirm()` with beautiful, themed dialogs that work across light and dark modes.

## Basic Usage

### Import the Dialog Service

```typescript
import { DialogService } from './services/dialog.service';

constructor(private dialogService: DialogService) {}
```

## Dialog Types

### 1. Alert Dialog

```typescript
// Basic alert
await this.dialogService.alert("Product added successfully!");

// With title
await this.dialogService.alert("All fields are required", "Validation Error");

// With type
await this.dialogService.alert("Changes saved!", "Success");
```

### 2. Confirm Dialog

```typescript
const confirmed = await this.dialogService.confirm("Are you sure you want to delete this item?", "Confirm Deletion");

if (confirmed) {
  // User clicked "Confirm"
  this.deleteItem();
} else {
  // User clicked "Cancel"
}
```

### 3. Success Dialog

```typescript
await this.dialogService.success("Product added successfully!");
await this.dialogService.success("Changes saved!", "Success");
```

### 4. Error Dialog

```typescript
await this.dialogService.error("Failed to save changes");
await this.dialogService.error("Invalid credentials", "Login Failed");
```

### 5. Warning Dialog

```typescript
await this.dialogService.warning("This action cannot be undone");
await this.dialogService.warning("Low stock alert", "Warning");
```

### 6. Info Dialog

```typescript
await this.dialogService.info("Please fill in all required fields");
```

## Migration Examples

### Before (using alert/confirm):

```typescript
alert("Please fill in all required fields");

if (confirm("Are you sure you want to delete this item?")) {
  this.deleteItem();
}
```

### After (using DialogService):

```typescript
await this.dialogService.error("Please fill in all required fields", "Validation Error");

if (await this.dialogService.confirm("Are you sure you want to delete this item?", "Confirm Deletion")) {
  this.deleteItem();
}
```

## Features

✅ **Theme Support** - Automatically adapts to light/dark mode  
✅ **Type-Based Styling** - Different colors for success, error, warning, info  
✅ **Animations** - Smooth fade-in and slide-in effects  
✅ **Responsive** - Works on mobile and desktop  
✅ **Backdrop Dismiss** - Click outside to close  
✅ **Keyboard Support** - ESC to close  
✅ **Promise-based** - Async/await compatible

## Dialog Types and Colors

- **Info** (ℹ️) - Blue
- **Success** (✅) - Green
- **Warning** (⚠️) - Orange
- **Error** (❌) - Red
- **Confirm** (❓) - Purple

## Tips

1. Use `await` to wait for user response
2. Success/Error/Warning are shortcuts for alert with type
3. Confirm returns boolean - true for confirm, false for cancel
4. All dialogs are Promise-based and can be chained
5. Dialogs automatically close when user clicks button or backdrop

## Example Component

```typescript
import { Component } from "@angular/core";
import { DialogService } from "./services/dialog.service";

@Component({
  selector: "app-example",
  template: `
    <button (click)="showAlert()">Show Alert</button>
    <button (click)="showConfirm()">Show Confirm</button>
  `,
})
export class ExampleComponent {
  constructor(private dialogService: DialogService) {}

  async showAlert() {
    await this.dialogService.success("Operation completed!");
  }

  async showConfirm() {
    const result = await this.dialogService.confirm("Do you want to proceed?", "Confirmation");

    if (result) {
      await this.dialogService.success("You confirmed!");
    }
  }
}
```
