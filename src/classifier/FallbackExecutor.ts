// @ts-ignore — dead code, will be removed in next major
/* DEAD CODE — duplicate of plugin.ts flow. Use LlmClient.ts + callLLMWithModelFallback instead. */
import { PluginConfig, FallbackAction } from '../types/PluginConfig'
import {
  ClassificationResult,
  createAllowResult,
  createDenyResult,
  createEscalateResult,
} from '../types/ClassificationResult'
import { TimeoutManager } from './TimeoutManager'

export class FallbackExecutor {
  private readonly config: PluginConfig
  private readonly timeoutManager: TimeoutManager

  constructor(config: PluginConfig, timeoutManager?: TimeoutManager) {
    this.config = config
    this.timeoutManager = timeoutManager || new TimeoutManager()
  }

  executeOnTimeout(error: unknown): ClassificationResult {
    const fallback = this.config.fallback.onTimeout
    const message = `LLM API timeout: ${error instanceof Error ? error.message : String(error)}`

    switch (fallback) {
      case 'allow':
        return createAllowResult(
          `${message} - action allowed per fallback config`,
          undefined,
          1
        )
      case 'deny':
        return createDenyResult(
          `${message} - action denied per fallback config`,
          undefined,
          1
        )
      case 'ask-user':
      default:
        return createEscalateResult(
          `${message} - user approval required per fallback config`
        )
    }
  }

  executeOnError(error: unknown): ClassificationResult {
    const fallback = this.config.fallback.onError
    const message = `LLM API error: ${error instanceof Error ? error.message : String(error)}`

    switch (fallback) {
      case 'allow':
        return createAllowResult(
          `${message} - action allowed per fallback config`,
          undefined,
          1
        )
      case 'deny':
        return createDenyResult(
          `${message} - action denied per fallback config`,
          undefined,
          1
        )
      case 'ask-user':
      default:
        return createEscalateResult(
          `${message} - user approval required per fallback config`
        )
    }
  }

  executeOnMalformedResponse(error: unknown): ClassificationResult {
    const message = `Malformed LLM response: ${error instanceof Error ? error.message : String(error)}`
    return createDenyResult(
      `${message} - action denied (safe failure for malformed response)`,
      undefined,
      1
    )
  }

  isTimeoutError(error: unknown): boolean {
    return this.timeoutManager.isTimeoutError(error)
  }

  determineFallbackAction(error: unknown): FallbackAction {
    if (this.isTimeoutError(error)) {
      return this.config.fallback.onTimeout
    }
    return this.config.fallback.onError
  }
}
