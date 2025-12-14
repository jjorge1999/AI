import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { SettingsService } from './settings.service';
import { Observable, from, of, throwError } from 'rxjs';
import { map, catchError, switchMap, tap } from 'rxjs/operators';

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

  init(): Observable<void> {
    if ((this.sentimentPipeline && this.generationPipeline) || this.isLoading)
      return of(void 0);

    if (!this.localModelsSupported) {
      console.log(
        'AI Service: Local models not supported on this browser, using Gemma API only'
      );
      return of(void 0);
    }

    this.isLoading = true;

    return from(import('@huggingface/transformers')).pipe(
      switchMap(async (transformers) => {
        const { pipeline } = transformers;

        // 1. Sentiment Analysis (always local)
        if (!this.sentimentPipeline) {
          this.sentimentPipeline = await pipeline(
            'sentiment-analysis',
            'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
          );
        }

        // 2. Text Generation - Local fallback model
        if (!this.generationPipeline) {
          this.generationPipeline = await pipeline(
            'text2text-generation',
            'Xenova/LaMini-Flan-T5-77M'
          );
        }
      }),
      map(() => {
        console.log('AI Service: Local models loaded successfully');
        this.isLoading = false;
        return void 0;
      }),
      catchError((error) => {
        console.error('AI Service: Failed to load local AI models', error);
        console.log('AI Service: Falling back to Gemma API only');
        this.localModelsSupported = false;
        this.isLoading = false;
        return of(void 0);
      })
    );
  }

  analyzeSentiment(
    text: string
  ): Observable<{ label: string; score: number } | null> {
    return this.init().pipe(
      switchMap(() => {
        if (!this.sentimentPipeline) return of(null);
        return from(this.sentimentPipeline(text) as Promise<any[]>);
      }),
      map((result) => {
        if (Array.isArray(result) && result.length > 0) {
          return result[0];
        }
        return null;
      }),
      catchError((e) => {
        console.error('AI Service: Sentiment analysis failed', e);
        return of(null);
      })
    );
  }

  /**
   * Generate text using Gemma API (preferred) or local model (fallback)
   */
  generateText(prompt: string): Observable<string | null> {
    // Try Gemma API first if enabled and token is available
    if (this.useGemmaApi && this.getHfToken()) {
      return this.generateWithGemma(prompt).pipe(
        switchMap((gemmaResult) => {
          if (gemmaResult) {
            return of(gemmaResult);
          }
          console.log(
            'AI Service: Gemma API failed, falling back to local model'
          );
          return this.generateWithLocalModel(prompt);
        })
      );
    }

    // Fallback to local model
    return this.generateWithLocalModel(prompt);
  }

  /**
   * Generate text specifically using Gemma via Hugging Face Inference Providers
   * Uses OpenAI-compatible chat completions format
   */
  generateWithGemma(prompt: string): Observable<string | null> {
    const hfToken = this.getHfToken();
    if (!hfToken) {
      console.warn('AI Service: No Hugging Face token available for Gemma API');
      return of(null);
    }

    return from(
      fetch(this.HF_API_URL, {
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
      })
    ).pipe(
      switchMap(async (response) => {
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error(
            'AI Service: Gemma API error',
            response.status,
            errorData
          );

          if (response.status === 503) {
            console.log(
              'AI Service: Gemma model is loading, retrying in 5s...'
            );
            await new Promise((resolve) => setTimeout(resolve, 5000));
            // Recursive retry needs to be handled carefully in Observables, usually using retryWhen or expand.
            // For simplicity here, we'll return null to trigger fallback, or we could just error.
            // To faithfully replicate await recursion:
            throw new Error('503 Service Unavailable');
          }
          return null;
        }
        return response.json();
      }),
      map((data: any) => {
        if (!data) return null;
        if (data.choices && data.choices.length > 0) {
          const message = data.choices[0].message;
          return message?.content?.trim() || null;
        }
        return null;
      }),
      catchError((e) => {
        if (e.message === '503 Service Unavailable') {
          // Simple retry logic could be added here or in the caller.
          // Since we can't easily recurse with simple return in this structure without `expand`, returning null causes fallback.
          return of(null);
        }
        console.error('AI Service: Gemma generation failed', e);
        return of(null);
      })
    );
  }

  /**
   * Generate text using local transformers model (fallback)
   */
  generateWithLocalModel(prompt: string): Observable<string | null> {
    return this.init().pipe(
      switchMap(() => {
        if (!this.generationPipeline) return of(null);
        return from(
          this.generationPipeline(prompt, {
            max_new_tokens: 60,
            temperature: 0.7,
            repetition_penalty: 1.2,
          }) as Promise<any[]>
        );
      }),
      map((result) => {
        if (Array.isArray(result) && result.length > 0) {
          return result[0].generated_text as string;
        }
        return null;
      }),
      catchError((e) => {
        console.error('AI Service: Local generation failed', e);
        return of(null);
      })
    );
  }

  /**
   * Chat-style generation with Gemma (for more complex conversations)
   */
  chatWithGemma(
    messages: { role: 'user' | 'model' | 'assistant'; content: string }[]
  ): Observable<string | null> {
    const hfToken = this.getHfToken();
    if (!hfToken) {
      console.warn('AI Service: No Hugging Face token for Gemma chat');
      return of(null);
    }

    // Convert 'model' role to 'assistant' for OpenAI compatibility
    const formattedMessages = messages.map((msg) => ({
      role: msg.role === 'model' ? 'assistant' : msg.role,
      content: msg.content,
    }));

    return from(
      fetch(this.HF_API_URL, {
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
      })
    ).pipe(
      switchMap(async (response) => {
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error(
            'AI Service: Gemma chat error',
            response.status,
            errorData
          );
          return null;
        }
        return response.json();
      }),
      map((data: any) => {
        if (!data) return null;
        if (data.choices && data.choices.length > 0) {
          const message = data.choices[0].message;
          return message?.content?.trim() || null;
        }
        return null;
      }),
      catchError((e) => {
        console.error('AI Service: Gemma chat failed', e);
        return of(null);
      })
    );
  }
}
