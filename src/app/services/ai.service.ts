import { Injectable } from '@angular/core';
import { pipeline } from '@huggingface/transformers';

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private sentimentPipeline: any = null;
  private isLoading = false;

  constructor() { }

  async init() {
    if (this.sentimentPipeline || this.isLoading) return;
    this.isLoading = true;
    try {
      // Use a small, efficient model for sentiment analysis
      // Quantized version is automatically loaded by default in browser if available
      this.sentimentPipeline = await pipeline('sentiment-analysis', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english');
      console.log('AI Service: Sentiment model loaded successfully');
    } catch (error) {
      console.error('AI Service: Failed to load sentiment model', error);
    } finally {
      this.isLoading = false;
    }
  }

  async analyzeSentiment(text: string): Promise<{ label: string; score: number } | null> {
    if (!this.sentimentPipeline) {
      await this.init();
    }

    if (!this.sentimentPipeline) return null;

    try {
      const result = await this.sentimentPipeline(text);
      // Result is typically an array like [{ label: 'POSITIVE', score: 0.99 }]
      if (Array.isArray(result) && result.length > 0) {
        return result[0]; // { label: 'POSITIVE' | 'NEGATIVE', score: number }
      }
      return null;
    } catch (e) {
      console.error('AI Service: Sentiment analysis failed', e);
      return null;
    }
  }
}
