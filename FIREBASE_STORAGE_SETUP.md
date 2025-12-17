# Firebase Storage Setup Guide

## Current Status

Your app is configured with:

- **Project ID**: inventory-8b0ad
- **Storage Bucket**: inventory-8b0ad.firebasestorage.app

## Steps to Enable Firebase Storage

### 1. Go to Firebase Console

Visit: https://console.firebase.google.com/project/inventory-8b0ad/storage

### 2. Enable Firebase Storage

If you see "Get Started":

- Click **"Get Started"**
- Accept default security rules
- Choose a location (e.g., `us-central1`)
- Click **"Done"**

### 3. Configure Storage Rules

Click the **"Rules"** tab and paste this:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      // Allow public read access
      allow read: if true;

      // Allow authenticated writes (or all writes for dev)
      allow write: if request.auth != null || true; // Change to just "request.auth != null" for production
    }
  }
}
```

Click **"Publish"**

### 4. Verify Connection

Open your app and check the browser console. You should see:

```
✅ Firebase Storage initialized successfully
Storage bucket: inventory-8b0ad.firebasestorage.app
```

### 5. Test Upload

1. Navigate to `/ads` in your app
2. Click "Upload New Ad"
3. Fill in the form and select an image (it will be auto-compressed!)
4. Watch the console for compression and upload logs

## Troubleshooting

### Error: "storage/unauthorized"

**Fix**: Update Storage Rules (see Step 3)

### Error: "ERR_FAILED" or CORS

**Fix**:

1. Ensure Storage is enabled (Step 2)
2. Check that your storageBucket in environment.ts matches: `inventory-8b0ad.firebasestorage.app`

### Error: "storage/unknown"

**Fix**: Firebase Storage might not be enabled yet (complete Step 2)

## Features Enabled

✅ **Automatic Image Compression**

- Max size: 2MB
- Max resolution: 1920x1080
- Quality: 80%
- Format: JPEG

✅ **Video Size Warnings**

- Warning for videos >50MB
- Metadata tracking

✅ **Real-time Progress**

- "Compressing..." status
- "Uploading..." status
- Success/error notifications

## Next Steps After Setup

1. Enable Storage (Steps 1-3)
2. Refresh your app
3. Check console for "✅ Firebase Storage initialized successfully"
4. Try uploading an ad!

## Support

If you still have issues, check:

- Firebase Console > Storage > Files (should see uploads)
- Browser Console (for detailed error messages)
- Network tab (to see actual requests)
