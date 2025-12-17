export interface Ad {
  id: string;
  title: string;
  type: 'video' | 'image';
  status: 'active' | 'paused' | 'pending' | 'draft';
  thumbnailUrl: string;
  mediaUrl: string; // Full video/image URL
  duration?: string; // for videos (e.g., "00:15")
  views?: number;
  ctr?: number; // click-through rate for images
  aspectRatio: string; // e.g., "16:9", "1:1", "9:16", "4:5"
  resolution: string; // e.g., "1920x1080"
  uploadDate: Date;
  createdBy: string; // userId who created the ad
  updatedAt?: Date;
  description?: string;
  targetUrl?: string; // URL the ad should link to
  impressions?: number; // Number of times shown
  clicks?: number; // Number of clicks
}

export interface AdFormData {
  title: string;
  type: 'video' | 'image';
  status: 'active' | 'paused' | 'pending' | 'draft';
  mediaFile?: File;
  thumbnailFile?: File;
  aspectRatio: string;
  description?: string;
  targetUrl?: string;
}
