# Migration Guide: Replace Native Dialogs with DialogService

## Files to Update

This guide shows all files that need to be updated to use the custom DialogService instead of native alert() and confirm().

## Step 1: Import DialogService

Add to each component's imports:

```typescript
import { DialogService } from "../../services/dialog.service";
```

Add to constructor:

```typescript
constructor(
  // ... other services
  private dialogService: DialogService
) {}
```

## Step 2: Make Methods Async

Any method that uses dialogs needs to be `async`:

```typescript
// Before
deleteItem(): void {

// After
async deleteItem(): Promise<void> {
```

## Components Requiring Updates

### 1. POS Calculator Component

**File**: `pos-calculator.component.ts`

**Changes**:

```typescript
// Line 5 - Add import
import { DialogService } from '../../services/dialog.service';

// Line 59 - Add to constructor
constructor(
  private inventoryService: InventoryService,
  private customerService: CustomerService,
  private dialogService: DialogService
) {

// Line 153 - Replace alert
- alert(message);
+ await this.dialogService.warning(message, 'Delivery Alert');

// Line 393 - Replace confirm (make method async)
async markAsDelivered(saleId: string): Promise<void> {
  if (await this.dialogService.confirm('Are you sure you want to mark this item as delivered?', 'Confirm Delivery')) {
    this.inventoryService.completePendingSale(saleId);
  }
}

// Line 400-402 - Replace confirm in confirmGroupReservation
async confirmGroupReservation(sales: Sale[]): Promise<void> {
  if (await this.dialogService.confirm(
    'This will mark all items as DELIVERED and deduct stock. Continue?',
    'Confirm Delivery'
  )) {
    sales.forEach((s) => this.inventoryService.completePendingSale(s.id));
  }
}

// Line 409 - Replace confirm in deleteReservation
async deleteReservation(sale: Sale): Promise<void> {
  if (await this.dialogService.confirm('Are you sure you want to remove this reservation?', 'Confirm Removal')) {
    this.inventoryService.deleteSale(sale.id);
  }
}

// Line 480-482 - Replace confirm in confirmReservation
async confirmReservation(sale: Sale): Promise<void> {
  if (await this.dialogService.confirm(
    'Are you sure you want to cancel this pending item? This will return stock to inventory.',
    'Confirm Cancellation'
  )) {
    this.inventoryService.confirmReservation(sale);
  }
}

// Line 490-492 - Replace confirm in markGroupAsDelivered
async markGroupAsDelivered(sales: Sale[]): Promise<void> {
  if (await this.dialogService.confirm(
    'This marks the order as confirmed. Stock remains reserved. Continue?',
    'Confirm Order'
  )) {
    sales.forEach((s) => this.inventoryService.completePendingSale(s.id));
  }
}

// Line 500 - Replace confirm in cancelGroupOrder
async cancelGroupOrder(sales: Sale[]): Promise<void> {
  if (await this.dialogService.confirm(
    `Cancel order for ${sales.length} items? This cannot be undone.`,
    'Cancel Order'
  )) {
    sales.forEach((s) => this.inventoryService.deleteSale(s.id));
  }
}
```

### 2. Reservation Component

**File**: `reservation.component.ts`

**Changes**:

```typescript
// Add import and constructor injection (same as above)

// Line 97 - Replace alert
-alert("Please fill in all required fields and add items to your reservation.");
+(await this.dialogService.error("Please fill in all required fields and add items to your reservation.", "Validation Error"));

// Line 135 - Replace alert in addToOrder
-alert(`Cannot add more. You already have ${currentInCart} in cart. Max stock is ${product.quantity}.`);
+(await this.dialogService.warning(`Cannot add more. You already have ${currentInCart} in cart. Max stock is ${product.quantity}.`, "Stock Limit"));

//Line 209 - Replace alert
-alert("Failed to submit reservation. Please try again.");
+(await this.dialogService.error("Failed to submit reservation. Please try again."));
```

Make `submitReservation` and `addToOrder` async.

### 3. Chat Component

**File**: `chat.component.ts`

**All alerts** should become:

```typescript
// Validation errors
await this.dialogService.error("Please enter your name", "Validation Error");
await this.dialogService.error("Please enter your phone number", "Validation Error");
await this.dialogService.error("Please enter your address", "Validation Error");
await this.dialogService.error("Please enter a valid phone number", "Validation Error");

// Access denied
await this.dialogService.error("Access Denied: You must be a registered customer to use the chat.", "Access Denied");

// Warnings
await this.dialogService.warning("Please select a conversation first.");
await this.dialogService.warning("Unable to retrieve location. Please enter manually.");

// Info
await this.dialogService.info("Do you want to update your customer information?");
await this.dialogService.info("You cannot logout of chat while logged into the application.");

// Errors
await this.dialogService.error("Failed to send message. Please try again.");
await this.dialogService.error("Failed to send audio message.");
await this.dialogService.error("Failed to delete message.");
await this.dialogService.error("Could not access microphone. Please allow permissions.");
await this.dialogService.error("Audio recording is not supported in this browser.");
await this.dialogService.error("Geolocation is not supported by your browser.");
await this.dialogService.error("Cannot start call: Unknown conversation.");

// Confirms
if (await this.dialogService.confirm("Are you sure you want to delete this message?", "Delete Message")) {
  // delete
}

if (await this.dialogService.confirm("Are you sure you want to logout? Your information will be cleared.", "Confirm Logout")) {
  // logout
}
```

### 4. Inventory List Component

**File**: `inventory-list.component.ts`

```typescript
// Line 292
-alert("Please enter a valid number greater than 0");
+(await this.dialogService.error("Please enter a valid number greater than 0", "Invalid Input"));

// Line 317
-alert("Product name cannot be empty");
+(await this.dialogService.error("Product name cannot be empty", "Validation Error"));

// Line 322
-alert("Quantity cannot be negative");
+(await this.dialogService.error("Quantity cannot be negative", "Validation Error"));

// Line 327
-alert("Price cannot be negative");
+(await this.dialogService.error("Price cannot be negative", "Validation Error"));
```

### 5. Customer Form Component

**File**: `customer-form.component.ts`

```typescript
// Line 77
async deleteCustomer(customerId: string): Promise<void> {
  if (await this.dialogService.confirm('Are you sure you want to delete this customer?', 'Delete Customer')) {
    this.customerService.deleteCustomer(customerId);
  }
}
```

### 6. User Management Component

**File**: `user-management.component.ts`

```typescript
// Line 74
- alert('Please fill in username and role.');
+ await this.dialogService.error('Please fill in username and role.', 'Validation Error');

// Line 80
- alert('Password is required for new users.');
+ await this.dialogService.error('Password is required for new users.', 'Validation Error');

// Line 120
async deleteUser(user: User): Promise<void> {
  if (await this.dialogService.confirm('Are you sure you want to delete this user?', 'Delete User')) {
    // delete logic
  }
}
```

### 7. Activity Logs Component

**File**: `activity-logs.component.ts`

```typescript
// Line 82
async cleanupLogs(): Promise<void> {
  if (await this.dialogService.confirm('This will delete all logs older than 30 days. Continue?', 'Cleanup Logs')) {
    // Line 85
    await this.dialogService.success(`Cleanup completed! Deleted ${result.deletedCount} logs.`);
    // Line 90
    await this.dialogService.error('Failed to cleanup logs');
  }
}
```

## Quick Reference

### Alert Types

```typescript
// Success (green)
await this.dialogService.success("Operation completed!");

// Error (red)
await this.dialogService.error("Something went wrong");

// Warning (orange)
await this.dialogService.warning("Please be careful");

// Info (blue)
await this.dialogService.info("Here is some information");
```

### Confirm Dialog

```typescript
const confirmed = await this.dialogService.confirm("Are you sure?", "Confirm Action");

if (confirmed) {
  // User clicked "Confirm"
} else {
  // User clicked "Cancel"
}
```

## Important Notes

1. **Make methods async**: Any method using dialogs must be `async`
2. **Use await**: Always use `await` before dialog calls
3. **Update HTML**: Change `(click)="method()"` - no changes needed, async methods work fine
4. **Return types**: Change `void` to `Promise<void>` for async methods
5. **Error handling**: Dialogs are promise-based, handle rejections if needed

## Benefits After Migration

- ✅ Consistent, beautiful UI across all dialogs
- ✅ Theme support (light/dark mode)
- ✅ Better user experience
- ✅ More accessible
- ✅ Customizable styling
- ✅ No browser-specific look
