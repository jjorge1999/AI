# HTTP Loading Interceptor - Auto-Implementation

## Overview

The loading interceptor automatically shows/hides the loading overlay for **ALL** HTTP requests in your application.

## How It Works

### Automatic Behavior

1. **HTTP Request Starts** → Loading overlay appears
2. **HTTP Request Completes** → Loading overlay disappears
3. **Multiple Requests** → Overlay stays visible until ALL requests complete

### Implementation Details

The interceptor:

- Tracks active HTTP requests with a counter
- Shows loading when first request starts
- Hides loading only when last request completes
- Handles success, error, and cancellation automatically

## Configuration

### Files Modified

1. ✅ `loading.interceptor.ts` - Created
2. ✅ `app.config.ts` - Registered interceptor

### No Additional Code Needed!

The interceptor is now **globally active**. Every HTTP request in your app will automatically:

- Show loading overlay
- Display "Loading..." message
- Hide overlay when complete

## Behavior Examples

### Single Request

```typescript
// Component code
this.productService.getProducts().subscribe((products) => {
  this.products = products;
});

// User sees:
// 1. Loading overlay appears ⏳
// 2. Request completes
// 3. Overlay disappears ✓
```

### Multiple Simultaneous Requests

```typescript
// Component code
this.productService.getProducts().subscribe(...);
this.customerService.getCustomers().subscribe(...);
this.salesService.getSales().subscribe(...);

// User sees:
// 1. Loading overlay appears ⏳
// 2. Products loaded (overlay still visible)
// 3. Customers loaded (overlay still visible)
// 4. Sales loaded
// 5. Overlay disappears ✓ (only when ALL complete)
```

### Error Handling

```typescript
// Even if request fails, overlay disappears
this.api.getData().subscribe({
  next: (data) => console.log(data),
  error: (err) => console.error(err), // Overlay still hides
});
```

## Customization Options

### Option 1: Custom Messages Per Request

Currently shows "Loading..." for all requests. To customize:

```typescript
// future enhancement - could add custom headers
const headers = new HttpHeaders({
  "X-Loading-Message": "Saving product...",
});
```

### Option 2: Skip Loading for Specific Requests

Add a custom header to bypass the interceptor:

```typescript
// In loading.interceptor.ts, add:
if (req.headers.has("X-Skip-Loading")) {
  return next(req);
}

// In your service:
const headers = new HttpHeaders({
  "X-Skip-Loading": "true",
});
this.http.get(url, { headers });
```

### Option 3: Different Messages for Different Endpoints

Enhance the interceptor to check URLs:

```typescript
// In loading.interceptor.ts:
let message = "Loading...";
if (req.url.includes("/products")) {
  message = "Loading products...";
} else if (req.url.includes("/sales")) {
  message = "Loading sales...";
}
loadingService.show(message);
```

## Affected Services

The interceptor automatically handles loading for:

✅ **InventoryService**

- getProducts()
- addProduct()
- updateProduct()
- recordSale()
- getSales()
- etc.

✅ **CustomerService**

- getCustomers()
- addCustomer()
- updateCustomer()
- deleteCustomer()

✅ **UserService**

- getUsers()
- addUser()
- updateUser()
- deleteUser()

✅ **LoggingService**

- getLogs()
- cleanupOldLogs()

✅ **ExpenseService**

- getExpenses()
- addExpense()

✅ **ChatService**

- sendMessage()
- deleteMessage()
- markAsRead()

## Benefits

✅ **Zero Boilerplate** - No need to manually call `loadingService.show/hide()`  
✅ **Consistent UX** - All requests get loading feedback  
✅ **Error Safe** - Loading hides even on errors  
✅ **Multi-Request Smart** - Handles concurrent requests properly  
✅ **Cancellation Safe** - Works with cancelled requests  
✅ **Easy to Disable** - Just remove from interceptors array

## Testing

To verify it's working:

1. Open app
2. Perform any action that makes an HTTP request
3. You should see the loading overlay appear
4. Overlay should disappear when complete

## Troubleshooting

### Loading doesn't appear

- Check browser console for errors
- Verify interceptor is registered in `app.config.ts`
- Ensure `LoadingComponent` is in app template

### Loading never disappears

- Check for uncaught errors in HTTP requests
- Verify `finalize()` operator is working
- Check browser console for interceptor errors

### Loading flickers too fast

- This is normal for cached/fast responses
- Could add minimum display time if needed

## Manual Override (If Needed)

If you need manual control for specific operations:

```typescript
// Disable interceptor for this request
const headers = new HttpHeaders({ "X-Skip-Loading": "true" });
this.http.get(url, { headers }).pipe(
  // Manually control loading
  tap(() => this.manualLoading.show("Custom message")),
  finalize(() => this.manualLoading.hide())
);
```

## Performance Impact

✅ **Minimal** - Interceptor adds negligible overhead  
✅ **Smart Counter** - Only one overlay for multiple requests  
✅ **Optimized** - Uses RxJS `finalize` for cleanup

## Summary

🎉 **HTTP Loading is now fully automated!**

Every HTTP request in your app will automatically show/hide the loading overlay. No additional code needed in components or services.
