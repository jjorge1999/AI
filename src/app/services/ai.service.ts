import { Injectable } from '@angular/core';
import { pipeline } from '@huggingface/transformers';

@Injectable({
  providedIn: 'root',
})
export class AiService {
  private sentimentPipeline: any = null;
  private generationPipeline: any = null;
  private isLoading = false;

  constructor() {}

  async init() {
    if ((this.sentimentPipeline && this.generationPipeline) || this.isLoading)
      return;
    this.isLoading = true;
    try {
      // 1. Sentiment Analysis
      if (!this.sentimentPipeline) {
        this.sentimentPipeline = await pipeline(
          'sentiment-analysis',
          'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
        );
      }

      // 2. Text Generation (Follow-up suggestions)
      // Using LaMini-Flan-T5-77M (lighter than 248M) for browser performance
      if (!this.generationPipeline) {
        this.generationPipeline = await pipeline(
          'text2text-generation',
          'Xenova/LaMini-Flan-T5-77M'
        );
      }

      console.log('AI Service: Models loaded successfully');
    } catch (error) {
      console.error('AI Service: Failed to load AI models', error);
    } finally {
      this.isLoading = false;
    }
  }

  async analyzeSentiment(
    text: string
  ): Promise<{ label: string; score: number } | null> {
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
  async generateText(prompt: string): Promise<string | null> {
    if (!this.generationPipeline) {
      await this.init();
    }
    if (!this.generationPipeline) return null;

    try {
      // Params: max_new_tokens controls length
      const result = await this.generationPipeline(prompt, {
        max_new_tokens: 60,
        temperature: 0.7,
        repetition_penalty: 1.2,
      });
      if (Array.isArray(result) && result.length > 0) {
        return result[0].generated_text;
      }
      return null;
    } catch (e) {
      console.error('AI Service: Generation failed', e);
      return null;
    }
  }
}
