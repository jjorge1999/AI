# Reservation Link Redirection - Setup Guide

## Overview

The app now supports direct links to the reservation page, allowing you to share a URL that automatically shows the reservation form without requiring login.

## Shareable Reservation Link

### Production URL

```
https://jjorge1999.github.io/AI/#/reservation
```

### Local Development URL

```
http://localhost:4200/#/reservation
```

## How It Works

### 1. Direct Link Access

When someone visits the URL with `#/reservation`:

1. ✅ App loads
2. ✅ Detects `#/reservation` in URL hash
3. ✅ Automatically shows reservation page
4. ✅ User can make reservation without logging in

### 2. URL Updates When Toggling

When user clicks "Make a Reservation" button:

- URL changes to include `#/reservation`
- Can be shared/bookmarked
- Refreshing page maintains reservation view

When user clicks "← Back to Login":

- URL hash is cleared
- Returns to login page

## Usage Examples

### Sharing the Link

**Via Text/Email:**

```
Hey! Make a reservation here:
https://jjorge1999.github.io/AI/#/reservation
```

**QR Code:**
Generate a QR code pointing to:

```
https://jjorge1999.github.io/AI/#/reservation
```

**Social Media:**

```
📅 Reserve your items now!
👉 https://jjorge1999.github.io/AI/#/reservation
```

### Embedding in Website

```html
<a href="https://jjorge1999.github.io/AI/#/reservation" target="_blank"> Make a Reservation </a>
```

### Programmatic Access

```typescript
// Get the reservation link in your component
const link = this.appComponent.getReservationLink();
console.log(link); // Full URL with hash
```

## Features

✅ **Direct Access** - No login required  
✅ **Shareable** - Send link via any channel  
✅ **Bookmarkable** - Users can save for later  
✅ **URL Persistence** - Stays on refresh  
✅ **Back Navigation** - Easy return to login

## Benefits for Users

### Customers

- Quick access to reservation form
- No need to navigate through login
- Can bookmark for repeat use
- Works on mobile and desktop

### Business

- Share link in marketing materials
- Add to social media profiles
- Include in email signatures
- Create QR codes for physical locations

## Implementation Details

### Files Modified

1. ✅ `app.component.ts` - Added URL hash detection
2. ✅ `app.component.html` - Updated button to use method
3. ✅ `app.routes.ts` - Created (for future routing)

### URL Hash Detection

```typescript
private checkUrlForReservation(): void {
  const hash = window.location.hash;
  if (hash === '#/reservation' || hash === '#reservation') {
    this.showReservation = true;
  }
}
```

### Toggle Method

```typescript
toggleReservation(): void {
  this.showReservation = !this.showReservation;

  if (this.showReservation) {
    window.location.hash = '#/reservation';
  } else {
    window.location.hash = '';
  }
}
```

## Marketing Materials

### Printable Cards

```
┌─────────────────────────────┐
│   Make Your Reservation     │
│                             │
│   [QR CODE]                 │
│                             │
│  Or visit:                  │
│  yourdomain.com/#/reservation│
└─────────────────────────────┘
```

### Email Signature

```
---
Make a Reservation
📅 https://jjorge1999.github.io/AI/#/reservation
```

### Social Media Bio

```
📦 JJM Inventory
📅 Reserve items: [link]
```

## Future Enhancements

### Query Parameters

Could add pre-filled data:

```
#/reservation?product=123&quantity=2
```

### Analytics Tracking

Track reservation link usage:

```typescript
if (hash.includes("reservation")) {
  analytics.track("Reservation Link Accessed");
}
```

### Multiple Landing Pages

Create more direct links:

```
#/reservation  - Reservation page
#/catalog      - Product catalog
#/contact      - Contact form
```

## Testing

### Test the Link

1. Open: `https://jjorge1999.github.io/AI/#/reservation`
2. Verify: Reservation form appears immediately
3. Fill form and submit
4. Check: Database records the reservation

### Test Toggle

1. Start at login page
2. Click "Make a Reservation"
3. Check: URL shows `#/reservation`
4. Refresh page
5. Verify: Still on reservation page

### Test Back Navigation

1. On reservation page
2. Click "← Back to Login"
3. Check: URL hash is cleared
4. Verify: Login page shows

## Deployment

After deployment, your shareable link will be:

```
https://jjorge1999.github.io/AI/#/reservation
```

This link:

- ✅ Works immediately after deployment
- ✅ No server configuration needed
- ✅ GitHub Pages compatible
- ✅ Works with custom domains

## Custom Domain Support

If you set up a custom domain (e.g., `craftedforme.com`):

```
https://craftedforme.com/#/reservation
```

The hash routing works with any domain!

## Summary

🎉 **Reservation Link is Ready!**

Share this link anywhere:

```
https://jjorge1999.github.io/AI/#/reservation
```

Customers can:

- ✅ Access reservation form directly
- ✅ No login required
- ✅ Bookmark for future use
- ✅ Share with others

Perfect for:

- 📧 Email campaigns
- 📱 Social media
- 🏪 In-store QR codes
- 💬 Customer support
