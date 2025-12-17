# Fix Firebase Storage CORS Error

## The Problem

Firebase Storage is blocking uploads from localhost:4200 due to CORS policy.

## Quick Fix (Recommended)

### Step 1: Go to Firebase Storage Rules

https://console.firebase.google.com/project/inventory-8b0ad/storage/inventory-8b0ad.firebasestorage.app/rules

### Step 2: Update Rules

Replace with:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if true;
      allow write: if true;
    }
  }
}
```

### Step 3: Publish

Click "Publish" button

### Step 4: Test

Refresh your app and try uploading again.

---

## Alternative: Configure CORS via Google Cloud

If the above doesn't work, you need to configure CORS at the bucket level:

### Method A: Using Google Cloud Console Web UI

1. Go to: https://console.cloud.google.com/storage/browser?project=inventory-8b0ad
2. Click on bucket: `inventory-8b0ad.firebasestorage.app`
3. Click "Permissions" tab
4. Grant public read access
5. Use Cloud Shell to set CORS (see below)

### Method B: Using Cloud Shell (Easiest)

1. Open Cloud Shell in Google Cloud Console (click >\_ icon)
2. Run these commands:

```bash
# Create CORS config
cat > cors.json << 'EOF'
[
  {
    "origin": ["*"],
    "method": ["GET", "POST", "PUT", "DELETE", "HEAD"],
    "maxAgeSeconds": 3600,
    "responseHeader": [
      "Content-Type",
      "Authorization",
      "Content-Length",
      "User-Agent",
      "X-Goog-Upload-Protocol",
      "X-Goog-Upload-Command",
      "X-Goog-Upload-Content-Length",
      "X-Goog-Upload-Offset"
    ]
  }
]
EOF

# Apply CORS config
gsutil cors set cors.json gs://inventory-8b0ad.firebasestorage.app

# Verify
gsutil cors get gs://inventory-8b0ad.firebasestorage.app
```

3. You should see the CORS configuration printed

### Method C: Install Google Cloud SDK Locally

1. Download: https://cloud.google.com/sdk/docs/install-sdk#windows
2. Run installer
3. Open new PowerShell window
4. Run:

```powershell
gcloud init
gcloud config set project inventory-8b0ad
gsutil cors set cors.json gs://inventory-8b0ad.firebasestorage.app
```

---

## Verification

After applying ANY of the above solutions:

1. **Clear browser cache** (Ctrl + Shift + Delete)
2. **Refresh the page** (Ctrl + F5)
3. Try uploading an image again
4. Check browser console for success messages

---

## Expected Console Output After Fix

```
✅ Compressing image: lechon.jpg Original size: 3.45 MB
✅ Image compressed: lechon.jpg New size: 1.23 MB Reduction: 64.3%
✅ Uploading file: 1765941816157_lechon.jpg Type: image/jpeg Size: 1.23 MB
✅ Upload successful: ads/media/1765941816157_lechon.jpg
✅ Download URL: https://firebasestorage.googleapis.com/...
```

---

## Still Having Issues?

Check:

1. ✅ Firebase Storage is enabled
2. ✅ Storage rules allow write access
3. ✅ CORS is configured (if using Option 3)
4. ✅ Browser cache is cleared
5. ✅ You're on the latest code (refresh the page)

## Contact

If none of these work, there might be a billing issue. Check:
https://console.firebase.google.com/project/inventory-8b0ad/usage/details
