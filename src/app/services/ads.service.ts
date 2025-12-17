// src/app/services/ads.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
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
import imageCompression from 'browser-image-compression';

/**
 * AdsService stores media (image/video) directly as Base64 strings inside Firestore
 * documents. This removes the dependency on Firebase Storage.
 *
 * NOTE: Firestore documents have a 1 MiB size limit. Files are compressed to fit.
 */
@Injectable({
  providedIn: 'root',
})
export class AdsService {
  private adsSubject = new BehaviorSubject<Ad[]>([]);
  public ads$ = this.adsSubject.asObservable();

  private unsubscribe: Unsubscribe | null = null;
  private db: Firestore;

  constructor(private firebaseService: FirebaseService) {
    this.db = this.firebaseService.db;
  }

  /** Start listening to the "ads" collection (real‑time) */
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
      const ads: Ad[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          uploadDate: data['uploadDate']?.toDate() || new Date(),
          updatedAt: data['updatedAt']?.toDate(),
        } as Ad;
      });
      this.adsSubject.next(ads);
    });
  }

  /** Stop listening to Firestore updates */
  stopListening(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** Expose ads as Observable */
  getAds(): Observable<Ad[]> {
    return this.ads$;
  }

  /** Helper to wrap a Promise in an Observable */
  private fromPromise<T>(fn: () => Promise<T>): Observable<T> {
    return from(fn());
  }

  /** Convert a File to a Base64 data‑URL string with compression */
  private fileToBase64(file: File): Observable<string> {
    return new Observable<string>((observer) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        observer.next(result);
        observer.complete();
      };
      reader.onerror = (err) => {
        observer.error(err);
      };

      // Compress images before conversion
      if (file.type.startsWith('image/')) {
        (async () => {
          try {
            const compressed = await this.compressImage(file);
            reader.readAsDataURL(compressed);
          } catch (e) {
            observer.error(e);
          }
        })();
      }
      // Compress videos before conversion
      else if (file.type.startsWith('video/')) {
        (async () => {
          try {
            console.log('🎬 Starting video compression...');
            const compressed = await this.compressVideo(file);
            reader.readAsDataURL(compressed);
          } catch (e) {
            console.error('Video compression failed, using original:', e);
            reader.readAsDataURL(file); // Fallback to original
          }
        })();
      } else {
        reader.readAsDataURL(file);
      }

      return () => {
        // no special cleanup needed for FileReader
      };
    });
  }

  /**
   * Compress image files before converting to Base64
   * Target ~500KB to stay under Firestore's 1MiB limit after Base64 encoding
   */
  private async compressImage(file: File): Promise<File> {
    const options = {
      maxSizeMB: 0.5, // 500KB max
      maxWidthOrHeight: 1280,
      useWebWorker: true,
      initialQuality: 0.7,
    };
    try {
      const compressed = await imageCompression(file, options);
      console.log(
        `✅ Image compressed: ${(file.size / 1024).toFixed(1)}KB → ${(
          compressed.size / 1024
        ).toFixed(1)}KB`
      );
      return compressed;
    } catch (e) {
      console.error('Image compression error:', e);
      return file;
    }
  }

  /**
   * Compress video using Canvas + MediaRecorder
   * Re-encodes at lower resolution (480p) and bitrate for smaller file size
   */
  private compressVideo(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      video.onloadedmetadata = async () => {
        // Target dimensions (max 480p for small file size)
        const maxWidth = 480;
        const maxHeight = 480;
        let width = video.videoWidth;
        let height = video.videoHeight;

        // Scale down if needed
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        console.log(
          `🎬 Compressing video: ${video.videoWidth}x${video.videoHeight} → ${width}x${height}`
        );

        // Create canvas for frame capture
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        // Set up MediaRecorder with low bitrate
        const stream = canvas.captureStream(15); // 15 FPS

        // Try to use VP8 for smaller file size, fallback to default
        let mimeType = 'video/webm;codecs=vp8';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/mp4';
          }
        }

        const mediaRecorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 500000, // 500 Kbps
        });

        const chunks: Blob[] = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
          const compressedFile = new File(
            [blob],
            file.name.replace(/\.\w+$/, '.webm'),
            {
              type: 'video/webm',
            }
          );
          console.log(
            `✅ Video compressed: ${(file.size / 1024).toFixed(1)}KB → ${(
              compressedFile.size / 1024
            ).toFixed(1)}KB`
          );

          // Clean up
          window.URL.revokeObjectURL(video.src);
          resolve(compressedFile);
        };

        mediaRecorder.onerror = (e) => {
          reject(e);
        };

        // Start recording and play video
        mediaRecorder.start();
        video.currentTime = 0;

        // Render frames to canvas
        const drawFrame = () => {
          if (video.paused || video.ended) {
            mediaRecorder.stop();
            return;
          }
          ctx.drawImage(video, 0, 0, width, height);
          requestAnimationFrame(drawFrame);
        };

        video.onplay = () => {
          drawFrame();
        };

        video.onended = () => {
          mediaRecorder.stop();
        };

        // Limit video to 10 seconds max
        const maxDuration = 10;
        setTimeout(() => {
          if (!video.paused && !video.ended) {
            video.pause();
            mediaRecorder.stop();
          }
        }, maxDuration * 1000);

        try {
          await video.play();
        } catch (e) {
          reject(new Error('Failed to play video for compression'));
        }
      };

      video.onerror = () => {
        reject(new Error('Failed to load video'));
      };

      video.src = URL.createObjectURL(file);
    });
  }

  /** Create a new ad – stores media as Base64 strings */
  createAd(adData: AdFormData, userId: string): Observable<string> {
    return this.fromPromise(async () => {
      let mediaBase64 = '';
      let thumbnailBase64 = '';

      if (adData.mediaFile) {
        mediaBase64 =
          (await this.fileToBase64(adData.mediaFile).toPromise()) ?? '';
      }

      if (adData.thumbnailFile) {
        thumbnailBase64 =
          (await this.fileToBase64(adData.thumbnailFile).toPromise()) ?? '';
      } else {
        thumbnailBase64 = adData.type === 'image' ? mediaBase64 : '';
      }

      // Validate total size before saving (Firestore limit is ~1MB)
      const MAX_BASE64_SIZE = 900000;
      const totalBase64Size = mediaBase64.length + thumbnailBase64.length;

      if (totalBase64Size > MAX_BASE64_SIZE) {
        const sizeMB = (totalBase64Size / 1024 / 1024).toFixed(2);
        throw new Error(
          `File too large (${sizeMB}MB). Please use an image under 500KB or a shorter video (max 10 seconds).`
        );
      }

      const resolution = this.getResolutionFromAspectRatio(adData.aspectRatio);

      const newAd = {
        title: adData.title,
        type: adData.type,
        status: adData.status || 'draft',
        thumbnailBase64,
        mediaBase64,
        aspectRatio: adData.aspectRatio,
        resolution,
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
    }).pipe(catchError(this.handleError));
  }

  /** Update an existing ad */
  updateAd(adId: string, updates: Partial<AdFormData>): Observable<void> {
    return this.fromPromise(async () => {
      const adRef = doc(this.db, 'ads', adId);
      const updateData: any = { ...updates, updatedAt: Timestamp.now() };

      if (updates.mediaFile) {
        updateData.mediaBase64 =
          (await this.fileToBase64(updates.mediaFile).toPromise()) ?? '';
        delete updateData.mediaFile;
      }

      if (updates.thumbnailFile) {
        updateData.thumbnailBase64 =
          (await this.fileToBase64(updates.thumbnailFile).toPromise()) ?? '';
        delete updateData.thumbnailFile;
      }

      if (updates.aspectRatio) {
        updateData.resolution = this.getResolutionFromAspectRatio(
          updates.aspectRatio
        );
      }

      await updateDoc(adRef, updateData);
    }).pipe(catchError(this.handleError));
  }

  /** Delete an ad */
  deleteAd(adId: string): Observable<void> {
    return this.fromPromise(async () => {
      const adRef = doc(this.db, 'ads', adId);
      await deleteDoc(adRef);
    }).pipe(catchError(this.handleError));
  }

  /** Update ad status */
  updateAdStatus(
    adId: string,
    status: 'active' | 'paused' | 'pending' | 'draft'
  ): Observable<void> {
    return this.fromPromise(async () => {
      const adRef = doc(this.db, 'ads', adId);
      await updateDoc(adRef, { status, updatedAt: Timestamp.now() });
    }).pipe(catchError(this.handleError));
  }

  /** Increment view count */
  incrementViews(adId: string): Observable<void> {
    return this.fromPromise(async () => {
      const ad = this.adsSubject.value.find((a) => a.id === adId);
      if (ad) {
        const adRef = doc(this.db, 'ads', adId);
        await updateDoc(adRef, { views: (ad.views || 0) + 1 });
      }
    }).pipe(catchError(this.handleError));
  }

  /** Increment click count and recalculate CTR */
  incrementClicks(adId: string): Observable<void> {
    return this.fromPromise(async () => {
      const ad = this.adsSubject.value.find((a) => a.id === adId);
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
    }).pipe(catchError(this.handleError));
  }

  /** Resolve resolution from aspect ratio */
  private getResolutionFromAspectRatio(aspectRatio: string): string {
    const map: { [key: string]: string } = {
      '16:9': '1920x1080',
      '9:16': '1080x1920',
      '1:1': '1080x1080',
      '4:5': '1080x1350',
      '4:3': '1024x768',
      '21:9': '2560x1080',
    };
    return map[aspectRatio] || '1920x1080';
  }

  /** Get video duration (mm:ss) */
  getVideoDuration(file: File): Observable<string> {
    return new Observable<string>((observer) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        const duration = Math.floor(video.duration);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        observer.next(
          `${minutes.toString().padStart(2, '0')}:${seconds
            .toString()
            .padStart(2, '0')}`
        );
        observer.complete();
      };
      video.onerror = () => {
        observer.error(new Error('Failed to load video metadata'));
      };
      video.src = URL.createObjectURL(file);
    });
  }

  /** Generic error handling for all service observables */
  private handleError = (err: any) => {
    console.error('AdsService error:', err);
    return throwError(() => err);
  };
}
