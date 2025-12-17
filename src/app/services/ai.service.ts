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
   * Falls back to alternative free models if rate limited
   */

  // List of models to try in order (primary + fallbacks)
  private readonly AI_MODELS = [
    'google/gemma-2-2b-it', // Primary - Gemma
    'meta-llama/Llama-3.2-3B-Instruct', // Fallback 1 - Llama
    'mistralai/Mistral-7B-Instruct-v0.3', // Fallback 2 - Mistral
    'Qwen/Qwen2.5-1.5B-Instruct', // Fallback 3 - Qwen (smaller)
  ];

  private currentModelIndex = 0;

  generateWithGemma(prompt: string): Observable<string | null> {
    const hfToken = this.getHfToken();
    if (!hfToken) {
      console.warn('AI Service: No Hugging Face token available for Gemma API');
      return of(null);
    }

    return this.tryModelWithFallback(prompt, hfToken, 0);
  }

  /**
   * Try a model, fall back to next if rate limited (402)
   */
  private tryModelWithFallback(
    prompt: string,
    hfToken: string,
    modelIndex: number
  ): Observable<string | null> {
    if (modelIndex >= this.AI_MODELS.length) {
      console.warn('AI Service: All models exhausted, falling back to local');
      return of(null);
    }

    const model = this.AI_MODELS[modelIndex];
    console.log(`AI Service: Trying model ${model}`);

    return from(
      fetch(this.HF_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
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
            `AI Service: Model ${model} error`,
            response.status,
            errorData
          );

          // Rate limit or payment required - try next model
          if (response.status === 402 || response.status === 429) {
            console.log(
              `AI Service: ${model} rate limited, trying next model...`
            );
            return { tryNext: true };
          }

          if (response.status === 503) {
            console.log(
              `AI Service: ${model} is loading, trying next model...`
            );
            return { tryNext: true };
          }

          return null;
        }
        return response.json();
      }),
      switchMap((data: any) => {
        // If we need to try the next model
        if (data && data.tryNext) {
          return this.tryModelWithFallback(prompt, hfToken, modelIndex + 1);
        }

        if (!data) return of(null);
        if (data.choices && data.choices.length > 0) {
          const message = data.choices[0].message;
          const content = message?.content?.trim() || null;
          if (content) {
            console.log(`AI Service: Successfully used model ${model}`);
            this.currentModelIndex = modelIndex; // Remember working model
          }
          return of(content);
        }
        return of(null);
      }),
      catchError((e) => {
        console.error(`AI Service: ${model} failed`, e);
        // Try next model on error
        if (modelIndex + 1 < this.AI_MODELS.length) {
          return this.tryModelWithFallback(prompt, hfToken, modelIndex + 1);
        }
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
   * Also falls back to alternative models if rate limited
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

    return this.tryChatWithFallback(formattedMessages, hfToken, 0);
  }

  /**
   * Try chat with a model, fall back to next if rate limited
   */
  private tryChatWithFallback(
    messages: { role: string; content: string }[],
    hfToken: string,
    modelIndex: number
  ): Observable<string | null> {
    if (modelIndex >= this.AI_MODELS.length) {
      console.warn('AI Service: All models exhausted for chat');
      return of(null);
    }

    const model = this.AI_MODELS[modelIndex];
    console.log(`AI Service: Trying chat model ${model}`);

    return from(
      fetch(this.HF_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          max_tokens: 200,
          temperature: 0.7,
        }),
      })
    ).pipe(
      switchMap(async (response) => {
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error(
            `AI Service: Chat model ${model} error`,
            response.status,
            errorData
          );

          // Rate limit or payment required - try next model
          if (
            response.status === 402 ||
            response.status === 429 ||
            response.status === 503
          ) {
            console.log(`AI Service: ${model} unavailable, trying next...`);
            return { tryNext: true };
          }
          return null;
        }
        return response.json();
      }),
      switchMap((data: any) => {
        if (data && data.tryNext) {
          return this.tryChatWithFallback(messages, hfToken, modelIndex + 1);
        }

        if (!data) return of(null);
        if (data.choices && data.choices.length > 0) {
          const message = data.choices[0].message;
          const content = message?.content?.trim() || null;
          if (content) {
            console.log(`AI Service: Chat successfully used model ${model}`);
          }
          return of(content);
        }
        return of(null);
      }),
      catchError((e) => {
        console.error(`AI Service: Chat ${model} failed`, e);
        if (modelIndex + 1 < this.AI_MODELS.length) {
          return this.tryChatWithFallback(messages, hfToken, modelIndex + 1);
        }
        return of(null);
      })
    );
  }
}
