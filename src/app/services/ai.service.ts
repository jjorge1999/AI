import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { SettingsService } from './settings.service';

// Hugging Face Inference API response interface
interface HfInferenceResponse {
  generated_text?: string;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AiService {
  private sentimentPipeline: any = null;
  private generationPipeline: any = null;
  private isLoading = false;
  private localModelsSupported = true; // Assume supported until proven otherwise

  // Hugging Face Inference Providers - OpenAI-compatible endpoint
  // Docs: https://huggingface.co/docs/inference-providers/
  private readonly HF_API_URL =
    'https://router.huggingface.co/v1/chat/completions';

  // Flag to prefer Gemma API over local models
  private useGemmaApi = true;

  constructor(private settingsService: SettingsService) {
    // Token is now loaded dynamically from SettingsService (Firebase + localStorage)
  }

  /**
   * Get the current HF token (from SettingsService which syncs Firebase + localStorage)
   */
  private getHfToken(): string | null {
    return (
      this.settingsService.getHuggingFaceToken() ||
      (environment as any).huggingFaceToken ||
      null
    );
  }

  /**
   * Set the Hugging Face API token for Gemma inference
   */
  setHuggingFaceToken(token: string): void {
    localStorage.setItem('hf_token', token);
    console.log('AI Service: Hugging Face token set');
  }

  /**
   * Check if Gemma API is available (token is set)
   */
  isGemmaApiAvailable(): boolean {
    const token = this.getHfToken();
    return !!token && token.startsWith('hf_');
  }

  /**
   * Toggle between Gemma API and local models
   */
  setUseGemmaApi(use: boolean = true): void {
    this.useGemmaApi = use;
    console.log(`AI Service: Using ${use ? 'Gemma API' : 'Local Models'}`);
  }

  async init() {
    if ((this.sentimentPipeline && this.generationPipeline) || this.isLoading)
      return;

    if (!this.localModelsSupported) {
      console.log(
        'AI Service: Local models not supported on this browser, using Gemma API only'
      );
      return;
    }

    this.isLoading = true;
    try {
      // Dynamic import to prevent crashes on older browsers
      const { pipeline } = await import('@huggingface/transformers');

      // 1. Sentiment Analysis (always local)
      if (!this.sentimentPipeline) {
        this.sentimentPipeline = await pipeline(
          'sentiment-analysis',
          'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
        );
      }

      // 2. Text Generation - Local fallback model
      // Using LaMini-Flan-T5-77M (lighter than 248M) for browser performance
      if (!this.generationPipeline) {
        this.generationPipeline = await pipeline(
          'text2text-generation',
          'Xenova/LaMini-Flan-T5-77M'
        );
      }

      console.log('AI Service: Local models loaded successfully');
    } catch (error) {
      console.error('AI Service: Failed to load local AI models', error);
      console.log('AI Service: Falling back to Gemma API only');
      this.localModelsSupported = false;
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

  /**
   * Generate text using Gemma API (preferred) or local model (fallback)
   */
  async generateText(prompt: string): Promise<string | null> {
    // Try Gemma API first if enabled and token is available
    if (this.useGemmaApi && this.getHfToken()) {
      const gemmaResult = await this.generateWithGemma(prompt);
      if (gemmaResult) {
        return gemmaResult;
      }
      console.log('AI Service: Gemma API failed, falling back to local model');
    }

    // Fallback to local model
    return this.generateWithLocalModel(prompt);
  }

  /**
   * Generate text specifically using Gemma via Hugging Face Inference Providers
   * Uses OpenAI-compatible chat completions format
   */
  async generateWithGemma(prompt: string): Promise<string | null> {
    const hfToken = this.getHfToken();
    if (!hfToken) {
      console.warn('AI Service: No Hugging Face token available for Gemma API');
      return null;
    }

    try {
      const response = await fetch(this.HF_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemma-2-2b-it',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 150,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(
          'AI Service: Gemma API error',
          response.status,
          errorData
        );

        // Handle model loading state (503 means model is loading)
        if (response.status === 503) {
          console.log('AI Service: Gemma model is loading, retrying in 5s...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return this.generateWithGemma(prompt); // Retry once
        }

        return null;
      }

      const data = await response.json();

      // Parse OpenAI-compatible response
      if (data.choices && data.choices.length > 0) {
        const message = data.choices[0].message;
        return message?.content?.trim() || null;
      }

      return null;
    } catch (e) {
      console.error('AI Service: Gemma generation failed', e);
      return null;
    }
  }

  /**
   * Generate text using local transformers model (fallback)
   */
  async generateWithLocalModel(prompt: string): Promise<string | null> {
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
      console.error('AI Service: Local generation failed', e);
      return null;
    }
  }

  /**
   * Chat-style generation with Gemma (for more complex conversations)
   */
  async chatWithGemma(
    messages: { role: 'user' | 'model' | 'assistant'; content: string }[]
  ): Promise<string | null> {
    const hfToken = this.getHfToken();
    if (!hfToken) {
      console.warn('AI Service: No Hugging Face token for Gemma chat');
      return null;
    }

    try {
      // Convert 'model' role to 'assistant' for OpenAI compatibility
      const formattedMessages = messages.map((msg) => ({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.content,
      }));

      const response = await fetch(this.HF_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemma-2-2b-it',
          messages: formattedMessages,
          max_tokens: 200,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(
          'AI Service: Gemma chat error',
          response.status,
          errorData
        );
        return null;
      }

      const data = await response.json();

      // Parse OpenAI-compatible response
      if (data.choices && data.choices.length > 0) {
        const message = data.choices[0].message;
        return message?.content?.trim() || null;
      }

      return null;
    } catch (e) {
      console.error('AI Service: Gemma chat failed', e);
      return null;
    }
  }
}
