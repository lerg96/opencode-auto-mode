// @ts-ignore — dead code, will be removed in next major
/* DEAD CODE — duplicate of plugin.ts flow. Use LlmClient.ts + callLLMWithModelFallback instead. */
export class RetryHandler {
  private readonly maxRetries: number
  private readonly baseDelayMs: number

  constructor(maxRetries?: number, baseDelayMs?: number) {
    this.maxRetries = Math.max(1, maxRetries ?? 2)
    this.baseDelayMs = baseDelayMs || 1000
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    isRetryable: (error: unknown) => boolean = this.defaultIsRetryable
  ): Promise<T> {
    let lastError: unknown = null

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error

        if (!isRetryable(error)) {
          throw error
        }

        if (attempt + 1 < this.maxRetries) {
          const delay = this.calculateBackoffDelay(attempt)
          await this.sleep(delay)
        }
      }
    }

    throw lastError
  }

  private defaultIsRetryable(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      if (message.includes('abort') || message.includes('timeout')) {
        return true
      }
      if (message.includes('network') || message.includes('econnrefused')) {
        return true
      }
      if (error.name === 'LlmParseError') {
        return false
      }
      if (error.name === 'LlmHttpError' && (error as { status: number }).status) {
        const status = (error as { status: number }).status
        if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 408) {
          return true
        }
        return false
      }
    }
    return false
  }

  calculateBackoffDelay(attempt: number): number {
    return this.baseDelayMs * Math.pow(2, attempt)
  }

  getMaxRetries(): number {
    return this.maxRetries
  }

  getBaseDelay(): number {
    return this.baseDelayMs
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
