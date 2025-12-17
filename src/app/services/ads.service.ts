import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { Ad, AdFormData } from '../models/ad.model';
import { FirebaseService } from './firebase.service';
import {
  Firestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  Timestamp,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import imageCompression from 'browser-image-compression';

@Injectable({
  providedIn: 'root',
})
export class AdsService {
  private adsSubject = new BehaviorSubject<Ad[]>([]);
  public ads$ = this.adsSubject.asObservable();
  private unsubscribe: Unsubscribe | null = null;
  private db: Firestore;
  private storage;

  constructor(private firebaseService: FirebaseService) {
    this.db = this.firebaseService.db;
    this.storage = getStorage(this.firebaseService.app);
    this.testStorageConnection();
  }

  /**
   * Test Firebase Storage connection
   */
  private async testStorageConnection(): Promise<void> {
    try {
      // Try to get a reference to the storage root
      const testRef = ref(this.storage, 'ads/');
      console.log('✅ Firebase Storage initialized successfully');
      console.log('Storage bucket:', this.storage.app.options.storageBucket);
    } catch (error) {
      console.error('❌ Firebase Storage connection failed:', error);
      console.error(
        'Please ensure Firebase Storage is enabled in your Firebase console'
      );
    }
  }

  /**
   * Start real-time listener for ads
   */
  startListening(userId?: string): void {
    const adsCollection = collection(this.db, 'ads');
    let q = query(adsCollection, orderBy('uploadDate', 'desc'));

    if (userId) {
      q = query(
        adsCollection,
        where('createdBy', '==', userId),
        orderBy('uploadDate', 'desc')
      );
    }

    this.unsubscribe = onSnapshot(q, (snapshot) => {
      const ads: Ad[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          uploadDate: data['uploadDate']?.toDate() || new Date(),
          updatedAt: data['updatedAt']?.toDate(),
        } as Ad;
      });
      this.adsSubject.next(ads);
    });
  }

  /**
   * Stop listening to Firestore updates
   */
  stopListening(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Get all ads as Observable
   */
  getAds(): Observable<Ad[]> {
    return this.ads$;
  }

  /**
   * Create a new ad
   */
  async createAd(adData: AdFormData, userId: string): Promise<string> {
    try {
      // Upload media file
      let mediaUrl = '';
      let thumbnailUrl = '';

      if (adData.mediaFile) {
        mediaUrl = await this.uploadFile(adData.mediaFile, 'ads/media');
      }

      // Upload thumbnail or generate from media
      if (adData.thumbnailFile) {
        thumbnailUrl = await this.uploadFile(
          adData.thumbnailFile,
          'ads/thumbnails'
        );
      } else {
        // Use media URL as thumbnail for images
        thumbnailUrl = adData.type === 'image' ? mediaUrl : '';
      }

      // Calculate resolution from aspect ratio if not provided
      const resolution = this.getResolutionFromAspectRatio(adData.aspectRatio);

      const newAd = {
        title: adData.title,
        type: adData.type,
        status: adData.status || 'draft',
        thumbnailUrl: thumbnailUrl,
        mediaUrl: mediaUrl,
        aspectRatio: adData.aspectRatio,
        resolution: resolution,
        description: adData.description || '',
        targetUrl: adData.targetUrl || '',
        uploadDate: Timestamp.now(),
        createdBy: userId,
        views: 0,
        impressions: 0,
        clicks: 0,
        ctr: 0,
      };

      const docRef = await addDoc(collection(this.db, 'ads'), newAd);
      return docRef.id;
    } catch (error) {
      console.error('Error creating ad:', error);
      throw error;
    }
  }

  /**
   * Update an existing ad
   */
  async updateAd(adId: string, updates: Partial<AdFormData>): Promise<void> {
    try {
      const adRef = doc(this.db, 'ads', adId);
      const updateData: any = {
        ...updates,
        updatedAt: Timestamp.now(),
      };

      // Handle media file update
      if (updates.mediaFile) {
        updateData.mediaUrl = await this.uploadFile(
          updates.mediaFile,
          'ads/media'
        );
        delete updateData.mediaFile;
      }

      // Handle thumbnail file update
      if (updates.thumbnailFile) {
        updateData.thumbnailUrl = await this.uploadFile(
          updates.thumbnailFile,
          'ads/thumbnails'
        );
        delete updateData.thumbnailFile;
      }

      // Update resolution if aspect ratio changed
      if (updates.aspectRatio) {
        updateData.resolution = this.getResolutionFromAspectRatio(
          updates.aspectRatio
        );
      }

      await updateDoc(adRef, updateData);
    } catch (error) {
      console.error('Error updating ad:', error);
      throw error;
    }
  }

  /**
   * Delete an ad
   */
  async deleteAd(adId: string): Promise<void> {
    try {
      // Get ad data to delete associated media files
      const ads = this.adsSubject.value;
      const ad = ads.find((a) => a.id === adId);

      if (ad) {
        // Delete media files from storage
        if (ad.mediaUrl) {
          await this.deleteFileFromUrl(ad.mediaUrl);
        }
        if (ad.thumbnailUrl && ad.thumbnailUrl !== ad.mediaUrl) {
          await this.deleteFileFromUrl(ad.thumbnailUrl);
        }
      }

      // Delete Firestore document
      const adRef = doc(this.db, 'ads', adId);
      await deleteDoc(adRef);
    } catch (error) {
      console.error('Error deleting ad:', error);
      throw error;
    }
  }

  /**
   * Update ad status
   */
  async updateAdStatus(
    adId: string,
    status: 'active' | 'paused' | 'pending' | 'draft'
  ): Promise<void> {
    try {
      const adRef = doc(this.db, 'ads', adId);
      await updateDoc(adRef, {
        status,
        updatedAt: Timestamp.now(),
      });
    } catch (error) {
      console.error('Error updating ad status:', error);
      throw error;
    }
  }

  /**
   * Increment ad views
   */
  async incrementViews(adId: string): Promise<void> {
    try {
      const ads = this.adsSubject.value;
      const ad = ads.find((a) => a.id === adId);
      if (ad) {
        const adRef = doc(this.db, 'ads', adId);
        await updateDoc(adRef, {
          views: (ad.views || 0) + 1,
        });
      }
    } catch (error) {
      console.error('Error incrementing views:', error);
      throw error;
    }
  }

  /**
   * Increment ad clicks and recalculate CTR
   */
  async incrementClicks(adId: string): Promise<void> {
    try {
      const ads = this.adsSubject.value;
      const ad = ads.find((a) => a.id === adId);
      if (ad) {
        const newClicks = (ad.clicks || 0) + 1;
        const newImpressions = ad.impressions || 1;
        const newCtr = (newClicks / newImpressions) * 100;

        const adRef = doc(this.db, 'ads', adId);
        await updateDoc(adRef, {
          clicks: newClicks,
          ctr: parseFloat(newCtr.toFixed(2)),
        });
      }
    } catch (error) {
      console.error('Error incrementing clicks:', error);
      throw error;
    }
  }

  /**
   * Compress file before upload
   */
  private async compressFile(file: File): Promise<File> {
    const fileType = file.type;

    // Compress images
    if (fileType.startsWith('image/')) {
      try {
        console.log(
          'Compressing image:',
          file.name,
          'Original size:',
          (file.size / 1024 / 1024).toFixed(2),
          'MB'
        );

        const options = {
          maxSizeMB: 2, // Maximum file size in MB
          maxWidthOrHeight: 1920, // Max dimension
          useWebWorker: true,
          fileType: 'image/jpeg', // Convert all to JPEG for better compression
          initialQuality: 0.8, // Quality setting
        };

        const compressedFile = await imageCompression(file, options);

        console.log(
          'Image compressed:',
          compressedFile.name,
          'New size:',
          (compressedFile.size / 1024 / 1024).toFixed(2),
          'MB',
          'Reduction:',
          ((1 - compressedFile.size / file.size) * 100).toFixed(1) + '%'
        );

        // Rename to keep original extension if it was already JPEG
        if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
          return new File([compressedFile], file.name, {
            type: compressedFile.type,
          });
        }

        // Otherwise, change extension to .jpg
        const newName = file.name.replace(/\.[^/.]+$/, '.jpg');
        return new File([compressedFile], newName, { type: 'image/jpeg' });
      } catch (error) {
        console.error('Image compression failed, using original file:', error);
        return file;
      }
    }

    // For videos, check size and provide warning
    if (fileType.startsWith('video/')) {
      const sizeMB = file.size / 1024 / 1024;
      console.log('Video file size:', sizeMB.toFixed(2), 'MB');

      if (sizeMB > 50) {
        console.warn(
          'Video file is large (>50MB). Consider compressing it externally for better performance.'
        );
      }

      // Note: Client-side video compression is complex and resource-intensive
      // For production, consider using a backend service or asking users to pre-compress
      return file;
    }

    return file;
  }

  /**
   * Upload a file to Firebase Storage
   */
  private async uploadFile(file: File, path: string): Promise<string> {
    try {
      // Compress file before upload
      const compressedFile = await this.compressFile(file);

      const timestamp = new Date().getTime();
      const fileName = `${timestamp}_${compressedFile.name}`;
      const storageRef = ref(this.storage, `${path}/${fileName}`);

      // Add metadata for better handling
      const metadata = {
        contentType: compressedFile.type,
        customMetadata: {
          uploadedAt: new Date().toISOString(),
          originalSize: file.size.toString(),
          compressedSize: compressedFile.size.toString(),
        },
      };

      console.log(
        'Uploading file:',
        fileName,
        'Type:',
        compressedFile.type,
        'Size:',
        (compressedFile.size / 1024 / 1024).toFixed(2),
        'MB'
      );

      // Upload the file with metadata
      const uploadResult = await uploadBytes(
        storageRef,
        compressedFile,
        metadata
      );
      console.log('Upload successful:', uploadResult.metadata.fullPath);

      // Get the download URL
      const downloadURL = await getDownloadURL(storageRef);
      console.log('Download URL:', downloadURL);

      return downloadURL;
    } catch (error: any) {
      console.error('Error uploading file:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);

      // Provide more specific error messages
      if (error.code === 'storage/unauthorized') {
        throw new Error(
          'Upload failed: You do not have permission to upload files. Please check Firebase Storage rules.'
        );
      } else if (error.code === 'storage/canceled') {
        throw new Error('Upload was canceled.');
      } else if (error.code === 'storage/unknown') {
        throw new Error(
          'Upload failed: Please check if Firebase Storage is enabled in your Firebase project.'
        );
      }

      throw error;
    }
  }

  /**
   * Delete a file from Firebase Storage using its URL
   */
  private async deleteFileFromUrl(fileUrl: string): Promise<void> {
    try {
      // Extract the storage path from the URL
      const decodedUrl = decodeURIComponent(fileUrl);
      const pathStart = decodedUrl.indexOf('/o/') + 3;
      const pathEnd = decodedUrl.indexOf('?');
      const filePath = decodedUrl.substring(pathStart, pathEnd);

      const fileRef = ref(this.storage, filePath);
      await deleteObject(fileRef);
    } catch (error) {
      console.error('Error deleting file:', error);
      // Don't throw error if file doesn't exist
    }
  }

  /**
   * Get standard resolution from aspect ratio
   */
  private getResolutionFromAspectRatio(aspectRatio: string): string {
    const resolutions: { [key: string]: string } = {
      '16:9': '1920x1080',
      '9:16': '1080x1920',
      '1:1': '1080x1080',
      '4:5': '1080x1350',
      '4:3': '1024x768',
      '21:9': '2560x1080',
    };
    return resolutions[aspectRatio] || '1920x1080';
  }

  /**
   * Get video duration from file (client-side)
   */
  getVideoDuration(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';

      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        const duration = Math.floor(video.duration);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        resolve(
          `${minutes.toString().padStart(2, '0')}:${seconds
            .toString()
            .padStart(2, '0')}`
        );
      };

      video.onerror = () => {
        reject(new Error('Failed to load video metadata'));
      };

      video.src = URL.createObjectURL(file);
    });
  }
}
