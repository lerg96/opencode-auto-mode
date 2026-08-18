// @ts-ignore — dead code, will be removed in next major
/* DEAD CODE — duplicate of plugin.ts flow. Use LlmClient.ts + callLLMWithModelFallback instead. */
export class TimeoutManager {
  private readonly stage1Timeout: number
  private readonly stage2Timeout: number

  constructor(stage1TimeoutMs?: number, stage2TimeoutMs?: number) {
    this.stage1Timeout = stage1TimeoutMs || 500
    this.stage2Timeout = stage2TimeoutMs || 5000
  }

  createStage1AbortController(): AbortController {
    const controller = new AbortController()
    if (this.stage1Timeout > 0) {
      const timeoutId = setTimeout(() => controller.abort(), this.stage1Timeout)
      attachTimeoutId(controller, timeoutId)
    }
    return controller
  }

  createStage2AbortController(): AbortController {
    const controller = new AbortController()
    if (this.stage2Timeout > 0) {
      const timeoutId = setTimeout(() => controller.abort(), this.stage2Timeout)
      attachTimeoutId(controller, timeoutId)
    }
    return controller
  }

  clearAbortController(controller: AbortController): void {
    const timeoutId = detachTimeoutId(controller)
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }

  isTimeoutError(error: unknown): boolean {
    if (error instanceof Error) {
      return (
        error.name === 'AbortError' ||
        error.message.includes('timeout') ||
        error.message.includes('AbortError')
      )
    }
    return false
  }

  getStage1Timeout(): number {
    return this.stage1Timeout
  }

  getStage2Timeout(): number {
    return this.stage2Timeout
  }
}

const TIMEOUT_ID_SYMBOL = Symbol('timeoutId')

function attachTimeoutId(controller: AbortController, timeoutId: unknown): void {
  ;(controller as unknown as Record<symbol, unknown>)[TIMEOUT_ID_SYMBOL] =
    timeoutId
}

function detachTimeoutId(controller: AbortController): unknown {
  const holder = controller as unknown as Record<symbol, unknown>
  const timeoutId = holder[TIMEOUT_ID_SYMBOL]
  delete holder[TIMEOUT_ID_SYMBOL]
  return timeoutId
}
