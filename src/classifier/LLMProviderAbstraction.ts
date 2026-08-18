// @ts-ignore — dead code, will be removed in next major
/* DEAD CODE — duplicate of plugin.ts flow. Use LlmClient.ts + callLLMWithModelFallback instead. */
import { Stage1Result, Stage2Result } from '../types/ClassificationResult'
import { PluginConfig } from '../types/PluginConfig'
import { TimeoutManager } from './TimeoutManager'
import { CircuitBreaker, CircuitState } from './CircuitBreaker'
import { RetryHandler } from './RetryHandler'
import { FallbackExecutor } from './FallbackExecutor'

export class LLMProviderAbstraction {
  private readonly config: PluginConfig
  private readonly timeoutManager: TimeoutManager
  private readonly circuitBreaker: CircuitBreaker
  private readonly retryHandler: RetryHandler
  private readonly fallbackExecutor: FallbackExecutor
  private readonly apiKey: string
  private startTimeMs?: number

  constructor(config: PluginConfig, apiKey: string) {
    this.config = config
    this.timeoutManager = new TimeoutManager()
    this.circuitBreaker = new CircuitBreaker()
    this.retryHandler = new RetryHandler()
    this.fallbackExecutor = new FallbackExecutor(config, this.timeoutManager)
    this.apiKey = apiKey
  }

  async classifyStage1(prompt: string): Promise<Stage1Result> {
    this.startTimeMs = Date.now()

    return await this.circuitBreaker.withCircuitBreaker(async () => {
      return await this.retryHandler.executeWithRetry(
        async () => {
          const controller = this.timeoutManager.createStage1AbortController()
          try {
            const result = await this.callLLMAPI(
              prompt,
              'stage1',
              controller.signal
            )
            this.applyLatency(result)
            return result as Stage1Result
          } catch (error) {
            if (this.timeoutManager.isTimeoutError(error)) {
              throw new Error(
                `Stage 1 timeout after ${this.timeoutManager.getStage1Timeout()}ms`
              )
            }
            throw error
          } finally {
            this.timeoutManager.clearAbortController(controller)
          }
        },
        (err) => !this.fallbackExecutor.isTimeoutError(err)
      )
    })
  }

  async classifyStage2(prompt: string): Promise<Stage2Result> {
    this.startTimeMs = Date.now()

    return await this.circuitBreaker.withCircuitBreaker(async () => {
      return await this.retryHandler.executeWithRetry(
        async () => {
          const controller = this.timeoutManager.createStage2AbortController()
          try {
            const result = await this.callLLMAPI(
              prompt,
              'stage2',
              controller.signal
            )
            this.applyLatency(result)
            return result as Stage2Result
          } catch (error) {
            if (this.timeoutManager.isTimeoutError(error)) {
              throw new Error(
                `Stage 2 timeout after ${this.timeoutManager.getStage2Timeout()}ms`
              )
            }
            throw error
          } finally {
            this.timeoutManager.clearAbortController(controller)
          }
        },
        (err) => !this.fallbackExecutor.isTimeoutError(err)
      )
    })
  }

  private async callLLMAPI(
    prompt: string,
    stage: 'stage1' | 'stage2',
    signal?: AbortSignal
  ): Promise<unknown> {
    const provider = this.config.llm.provider

    if (provider === 'anthropic') {
      return this.callAnthropic(prompt, stage, signal)
    } else if (provider === 'openai') {
      return this.callOpenAI(prompt, stage, signal)
    } else {
      return this.callLocal(prompt, stage, signal)
    }
  }

  private async callAnthropic(
    prompt: string,
    stage: 'stage1' | 'stage2',
    signal?: AbortSignal
  ): Promise<unknown> {
    const controller = signal ? { signal } : new AbortController()
    const timeout = this.config.llm.timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!signal) (controller as AbortController).abort()
      }, timeout)
    }

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
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(
          `Anthropic API error: ${response.status} ${response.statusText}`
        )
      }

      const data = await response.json()
      return this.parseAnthropicResponse(data, stage)
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  private async callOpenAI(
    prompt: string,
    stage: 'stage1' | 'stage2',
    signal?: AbortSignal
  ): Promise<unknown> {
    const controller = signal ? { signal } : new AbortController()
    const timeout = this.config.llm.timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!signal) (controller as AbortController).abort()
      }, timeout)
    }

    try {
      const baseUrl = this.config.llm.baseUrl || 'https://api.openai.com'
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.llm.model,
          max_tokens: stage === 'stage1' ? 1 : 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText}`
        )
      }
      const data = await response.json()
      return this.parseOpenAIResponse(data, stage)
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  private async callLocal(
    prompt: string,
    stage: 'stage1' | 'stage2',
    signal?: AbortSignal
  ): Promise<unknown> {
    const controller = signal ? { signal } : new AbortController()
    const timeout = this.config.llm.timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!signal) (controller as AbortController).abort()
      }, timeout)
    }

    try {
      const baseUrl = this.config.llm.baseUrl || 'http://localhost:18780/v1'
      let endpoint: string
      if (baseUrl.endsWith('/v1')) {
        endpoint = `${baseUrl}/chat/completions`
      } else if (baseUrl.endsWith('/v1/')) {
        endpoint = `${baseUrl}chat/completions`
      } else {
        endpoint = `${baseUrl}/chat/completions`
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.llm.model,
          max_tokens: stage === 'stage1' ? 1 : 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(
          `Local model API error: ${response.status} ${response.statusText}`
        )
      }
      const data = await response.json()
      const result = this.parseOpenAIResponse(data, stage)
      this.applyLatency(result)
      return result
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

 private applyLatency(result: unknown): void {
    if (
      result &&
      typeof result === 'object' &&
      'latency' in result &&
      this.startTimeMs !== undefined
    ) {
      const parsed = result as Record<string, unknown>
      if (typeof parsed.latency === 'number') {
        const duration = Date.now() - this.startTimeMs
        parsed.latency = duration
      }
    }
  }

  private parseAnthropicResponse(
    data: unknown,
    stage: 'stage1' | 'stage2'
  ): unknown {
    if (
      data &&
      typeof data === 'object' &&
      'content' in data &&
      Array.isArray((data as { content: unknown[] }).content)
    ) {
      const content = (data as { content: { text?: string }[] }).content
      const text = content[0]?.text || ''

      if (stage === 'stage1') {
        const prediction: 'block' | 'allow' = text
          .toLowerCase()
          .includes('block')
          ? 'block'
          : 'allow'
        return { prediction, confidence: undefined, latency: 0 }
      }

      return {
        reasoning: text,
        decision:
          text.toLowerCase().includes('deny') ||
          text.toLowerCase().includes('block')
            ? 'deny'
            : 'allow',
        confidence: undefined,
        latency: 0,
      }
    }
    throw new Error('Malformed Anthropic response')
  }

  private parseOpenAIResponse(
    data: unknown,
    stage: 'stage1' | 'stage2'
  ): unknown {
    if (
      data &&
      typeof data === 'object' &&
      'choices' in data &&
      Array.isArray((data as { choices: unknown[] }).choices)
    ) {
      const choices = (
        data as { choices: { message?: { content?: string } }[] }
      ).choices
      const text = choices[0]?.message?.content || ''

      if (stage === 'stage1') {
        const prediction: 'block' | 'allow' = text
          .toLowerCase()
          .includes('block')
          ? 'block'
          : 'allow'
        return { prediction, confidence: undefined, latency: 0 }
      }

      return {
        reasoning: text,
        decision:
          text.toLowerCase().includes('deny') ||
          text.toLowerCase().includes('block')
            ? 'deny'
            : 'allow',
        confidence: undefined,
        latency: 0,
      }
    }
    throw new Error('Malformed OpenAI response')
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker
  }
}
