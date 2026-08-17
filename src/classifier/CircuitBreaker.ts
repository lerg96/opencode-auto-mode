// @ts-ignore — dead code, will be removed in next major
/* DEAD CODE — duplicate of plugin.ts flow. Use LlmClient.ts + callLLMWithModelFallback instead. */
export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED
  private failureCount: number
  private readonly failureThreshold: number
  private readonly recoveryTimeout: number
  private lastFailureTime: number | null
  private halfOpenInProgress: boolean = false

  constructor(failureThreshold?: number, recoveryTimeoutMs?: number) {
    this.failureThreshold = failureThreshold || 3
    this.failureCount = 0
    this.recoveryTimeout = recoveryTimeoutMs || 30000
    this.lastFailureTime = null
  }

  async withCircuitBreaker<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime > this.recoveryTimeout
      ) {
        if (this.halfOpenInProgress) {
          throw new Error(
            'Circuit breaker is HALF_OPEN - probe already in progress'
          )
        }
        this.halfOpenInProgress = true
        this.state = CircuitState.HALF_OPEN
      } else {
        throw new Error('Circuit breaker is OPEN - LLM API unavailable')
      }
    } else if (this.state === CircuitState.HALF_OPEN && this.halfOpenInProgress) {
      throw new Error('Circuit breaker is HALF_OPEN - probe already in progress')
    }

    try {
      const result = await operation()
      this.onSuccess()
      return result
    } catch (error) {
      this.halfOpenInProgress = false
      const justOpened = this.onFailure()
      if (justOpened) {
        const originalMessage =
          error instanceof Error ? error.message : String(error)
        throw new Error(
          `Circuit breaker is OPEN - LLM API unavailable (original: ${originalMessage})`
        )
      }
      throw error
    }
  }

  private onSuccess(): void {
    this.halfOpenInProgress = false
    this.failureCount = 0
    this.state = CircuitState.CLOSED
  }

  private onFailure(): boolean {
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN
      return true
    }
    return false
  }

  getState(): CircuitState {
    return this.state
  }

  getFailureCount(): number {
    return this.failureCount
  }

  reset(): void {
    this.failureCount = 0
    this.state = CircuitState.CLOSED
    this.lastFailureTime = null
  }
}
