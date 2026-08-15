import { Stage1Result, Stage2Result } from '../types/ClassificationResult';
import { PluginConfig } from '../types/PluginConfig';
import { TimeoutManager } from './TimeoutManager';
import { CircuitBreaker, CircuitState } from './CircuitBreaker';
import { RetryHandler } from './RetryHandler';
import { FallbackExecutor } from './FallbackExecutor';

export class LLMProviderAbstraction {
  private readonly config: PluginConfig;
  private readonly timeoutManager: TimeoutManager;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryHandler: RetryHandler;
  private readonly fallbackExecutor: FallbackExecutor;
  private readonly apiKey: string;

  constructor(config: PluginConfig, apiKey: string) {
    this.config = config;
    this.timeoutManager = new TimeoutManager();
    this.circuitBreaker = new CircuitBreaker();
    this.retryHandler = new RetryHandler();
    this.fallbackExecutor = new FallbackExecutor(config, this.timeoutManager);
    this.apiKey = apiKey;
  }

  async classifyStage1(prompt: string): Promise<Stage1Result> {
    const startTime = Date.now();

    try {
      return await this.circuitBreaker.withCircuitBreaker(async () => {
        return await this.retryHandler.executeWithRetry(
          async () => {
            const controller = this.timeoutManager.createStage1AbortController();
            try {
              const result = await this.callLLMAPI(prompt, 'stage1', controller.signal);
              return result as Stage1Result;
            } catch (error) {
              if (this.timeoutManager.isTimeoutError(error)) {
                throw new Error(`Stage 1 timeout after ${this.timeoutManager.getStage1Timeout()}ms`);
              }
              throw error;
            }
          },
          (err) => !this.fallbackExecutor.isTimeoutError(err)
        );
      });
    } catch (error) {
      if (this.circuitBreaker.getState() === CircuitState.OPEN) {
        console.warn('[Auto-Mode] Circuit breaker OPEN during Stage 1');
      }
      throw error;
    }
  }

  async classifyStage2(prompt: string): Promise<Stage2Result> {
    const startTime = Date.now();

    try {
      return await this.circuitBreaker.withCircuitBreaker(async () => {
        return await this.retryHandler.executeWithRetry(
          async () => {
            const controller = this.timeoutManager.createStage2AbortController();
            try {
              const result = await this.callLLMAPI(prompt, 'stage2', controller.signal);
              return result as Stage2Result;
            } catch (error) {
              if (this.timeoutManager.isTimeoutError(error)) {
                throw new Error(`Stage 2 timeout after ${this.timeoutManager.getStage2Timeout()}ms`);
              }
              throw error;
            }
          },
          (err) => !this.fallbackExecutor.isTimeoutError(err)
        );
      });
    } catch (error) {
      if (this.circuitBreaker.getState() === CircuitState.OPEN) {
        console.warn('[Auto-Mode] Circuit breaker OPEN during Stage 2');
      }
      throw error;
    }
  }

  private async callLLMAPI(
    prompt: string,
    stage: 'stage1' | 'stage2',
    signal?: AbortSignal
  ): Promise<unknown> {
    const provider = this.config.llm.provider;

    if (provider === 'anthropic') {
      return this.callAnthropic(prompt, stage, signal);
    } else if (provider === 'openai') {
      return this.callOpenAI(prompt, stage, signal);
    } else {
      return this.callLocal(prompt, stage, signal);
    }
  }

  private async callAnthropic(prompt: string, stage: 'stage1' | 'stage2', signal?: AbortSignal): Promise<unknown> {
    const controller = signal ? { signal } : new AbortController();
    const timeoutId = setTimeout(() => {
      if (!signal) (controller as AbortController).abort();
    }, 10000);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.llm.model,
          max_tokens: stage === 'stage1' ? 1 : 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return this.parseAnthropicResponse(data, stage);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private callOpenAI(prompt: string, stage: 'stage1' | 'stage2', signal?: AbortSignal): Promise<unknown> {
    const controller = signal ? { signal } : new AbortController();
    const timeoutId = setTimeout(() => {
      if (!signal) (controller as AbortController).abort();
    }, 10000);

    const promise = fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.llm.model,
        max_tokens: stage === 'stage1' ? 1 : 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    }).then(async (response) => {
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      return this.parseOpenAIResponse(data, stage);
    }).catch((error) => {
      clearTimeout(timeoutId);
      throw error;
    });

    return promise;
  }

  private callLocal(prompt: string, stage: 'stage1' | 'stage2', signal?: AbortSignal): Promise<unknown> {
    const controller = signal ? { signal } : new AbortController();
    const timeoutId = setTimeout(() => {
      if (!signal) (controller as AbortController).abort();
    }, 10000);

    const promise = fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.llm.model,
        prompt: prompt,
        stream: false,
        max_tokens: stage === 'stage1' ? 1 : 1024,
      }),
      signal: controller.signal,
    }).then(async (response) => {
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`Local model API error: ${response.status} ${response.statusText}`);
      }
      return response.json();
    }).catch((error) => {
      clearTimeout(timeoutId);
      throw error;
    });

    return promise;
  }

  private parseAnthropicResponse(data: unknown, stage: 'stage1' | 'stage2'): unknown {
    if (
      data &&
      typeof data === 'object' &&
      'content' in data &&
      Array.isArray((data as { content: unknown[] }).content)
    ) {
      const content = (data as { content: { text?: string }[] }).content;
      const text = content[0]?.text || '';

      if (stage === 'stage1') {
        const prediction: 'block' | 'allow' = text.toLowerCase().includes('block') ? 'block' : 'allow';
        return { prediction, confidence: undefined, latency: 0 };
      }

      return {
        reasoning: text,
        decision: text.toLowerCase().includes('deny') || text.toLowerCase().includes('block') ? 'deny' : 'allow',
        confidence: undefined,
        latency: 0,
      };
    }
    throw new Error('Malformed Anthropic response');
  }

  private parseOpenAIResponse(data: unknown, stage: 'stage1' | 'stage2'): unknown {
    if (
      data &&
      typeof data === 'object' &&
      'choices' in data &&
      Array.isArray((data as { choices: unknown[] }).choices)
    ) {
      const choices = (data as { choices: { message?: { content?: string } }[] }).choices;
      const text = choices[0]?.message?.content || '';

      if (stage === 'stage1') {
        const prediction: 'block' | 'allow' = text.toLowerCase().includes('block') ? 'block' : 'allow';
        return { prediction, confidence: undefined, latency: 0 };
      }

      return {
        reasoning: text,
        decision: text.toLowerCase().includes('deny') || text.toLowerCase().includes('block') ? 'deny' : 'allow',
        confidence: undefined,
        latency: 0,
      };
    }
    throw new Error('Malformed OpenAI response');
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }
}
