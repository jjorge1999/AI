# Delivery Reminder on Login - Implementation Guide

## Objective

Trigger delivery reminders immediately when the user logs in, not just when they navigate to the POS page.

## Implementation

Add these changes to `src/app/app.component.ts`:

### 1. Add Imports

```typescript
import { DialogService } from "./services/dialog.service";
import { Sale } from "./models/inventory.models";
```

### 2. Update Constructor

```typescript
constructor(
  private inventoryService: InventoryService,
  private chatService: ChatService,
  private dialogService: DialogService // Add this
) {
  // ... existing code ...

  // Check delivery reminders on login
  if (this.isLoggedIn) {
    this.checkDeliveryReminders();
  }
}
```

### 3. Add These Methods

```typescript
private checkDeliveryReminders(): void {
  // Check pending deliveries for reminders (1-2 days ahead or overdue)
  this.inventoryService.getSales().subscribe((sales: Sale[]) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Filter only pending sales with delivery dates
    const pendingSales = sales.filter(s =>
      s.deliveryDate && s.status !== 'completed'
    );

    pendingSales.forEach((sale: Sale) => {
      if (!sale.deliveryDate) return;

      const delivery = new Date(sale.deliveryDate);
      const diffMs = delivery.getTime() - now.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      // Trigger alarm for 1-2 days ahead or overdue (negative days)
      if (diffDays === 1 || diffDays === 2 || diffDays < 0) {
        this.showDeliveryReminder(sale, diffDays);
      }
    });
  });
}

private showDeliveryReminder(sale: Sale, daysAhead: number): void {
  const delivery = new Date(sale.deliveryDate!);
  const dateStr = delivery.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  let message: string;
  if (daysAhead < 0) {
    message = `🔴 Delivery for "${sale.productName}" is OVERDUE by ${Math.abs(daysAhead)} day(s) (was due ${dateStr}).`;
  } else {
    message = `⚠️ Delivery for "${sale.productName}" is due in ${daysAhead} day(s) (${dateStr}).`;
  }

  this.playBeep();
  this.dialogService.alert(message, 'Delivery Reminder', 'warning');
}

private playBeep(): void {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.frequency.value = 800;
  oscillator.type = 'sine';

  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.5);
}
```

## How It Works

1. **On Login**: When the constructor runs and `isLoggedIn` is true, it calls `checkDeliveryReminders()`
2. **Check Sales**: Gets all sales from the InventoryService
3. **Filter**: Only looks at pending sales with delivery dates
4. **Calculate**: Determines how many days until/since delivery
5. **Alert**: Shows dialog for deliveries:
   - 1 day ahead
   - 2 days ahead
   - Overdue (negative days)
6. **Sound**: Plays beep to get user's attention
7. **Dialog**: Shows custom warning dialog with details

## Benefits

✅ Immediate notification on login  
✅ No need to navigate to POS page  
✅ Shows overdue deliveries prominently  
✅ Uses new custom dialog system  
✅ Plays audio alert

## Manual Steps

1. Open `src/app/app.component.ts`
2. Add the imports at the top
3. Add `DialogService` to constructor parameters
4. Add the `checkDeliveryReminders()` call in constructor
5. Copy the three methods to the bottom of the class
6. Save and test!
