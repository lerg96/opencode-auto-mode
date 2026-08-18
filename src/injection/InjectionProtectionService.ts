import { InjectionProbe } from './InjectionProbe'
import { InjectionResult } from './types'

export interface InjectionProtectionConfig {
  enabled: boolean
  scanToolResults: boolean
  scanUserMessages: boolean
  customPatterns?: Array<{ pattern: string; description: string }>
}

const MAX_PATTERN_LENGTH = 500
const REDOS_PATTERNS = [
  /\(\[[^)]*\]\)\*[+*]/,
  /\(\[[^)]*\]\)\+[+*]/,
  /[+*][+*]/,
  /\([+*][+*]\)/,
  /\{[+*]\}\{/,
]

function isValidInjectionPattern(pattern: string): boolean {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) {
    return false
  }
  for (const redosPattern of REDOS_PATTERNS) {
    if (redosPattern.test(pattern)) {
      return false
    }
  }
  try {
    new RegExp(pattern, 'i')
    return true
  } catch {
    return false
  }
}

export interface InjectionProtectionHookResult {
  injectionDetected: boolean
  result?: InjectionResult
  message?: string
}

const DEFAULT_PROTECTION_CONFIG: InjectionProtectionConfig = {
  enabled: true,
  scanToolResults: true,
  scanUserMessages: true,
}

export class InjectionProtectionService {
  private probe: InjectionProbe
  private config: InjectionProtectionConfig
  private sessionsScanned: Map<string, number>

  constructor(config?: Partial<InjectionProtectionConfig>) {
    this.config = {
      ...DEFAULT_PROTECTION_CONFIG,
      ...config,
    } as InjectionProtectionConfig
    this.sessionsScanned = new Map()

    if (this.config.customPatterns && this.config.customPatterns.length > 0) {
      const validPatterns = this.config.customPatterns
        .filter((p) => isValidInjectionPattern(p.pattern))
        .map((p) => ({
          type: 'custom' as const,
          pattern: new RegExp(p.pattern, 'i'),
          description: p.description || 'Custom injection pattern',
        }))
      if (validPatterns.length > 0) {
        this.probe = new InjectionProbe(validPatterns)
      } else {
        this.probe = new InjectionProbe()
      }
    } else {
      this.probe = new InjectionProbe()
    }
  }

  async scanToolResult(
    toolResult: string,
    sessionId?: string
  ): Promise<InjectionProtectionHookResult> {
    if (!this.config.enabled || !this.config.scanToolResults) {
      return { injectionDetected: false }
    }

    const result = await this.probe.scan(toolResult)

    if (sessionId) {
      const count = this.sessionsScanned.get(sessionId) || 0
      this.sessionsScanned.set(sessionId, count + 1)
    }

    if (result.injected) {
      return {
        injectionDetected: true,
        result,
        message: `Injection detected: ${result.pattern} (${result.patternType}). Manual review required.`,
      }
    }

    return { injectionDetected: false }
  }

  async scanMessage(message: string): Promise<InjectionProtectionHookResult> {
    if (!this.config.enabled || !this.config.scanUserMessages) {
      return { injectionDetected: false }
    }

    const result = await this.probe.scan(message)

    if (result.injected) {
      return {
        injectionDetected: true,
        result,
        message: `Injection detected in message: ${result.pattern} (${result.patternType}).`,
      }
    }

    return { injectionDetected: false }
  }

  async handleToolResult(context: {
    sessionId?: string
    toolResult?: string
  }): Promise<InjectionProtectionHookResult> {
    if (!this.config.enabled || !this.config.scanToolResults) {
      return { injectionDetected: false }
    }

    if (!context.toolResult) {
      return { injectionDetected: false }
    }

    return await this.scanToolResult(context.toolResult, context.sessionId)
  }

  getScanCount(sessionId: string): number {
    return this.sessionsScanned.get(sessionId) || 0
  }

  resetSession(sessionId: string): void {
    this.sessionsScanned.delete(sessionId)
  }

  getConfig(): InjectionProtectionConfig {
    return { ...this.config }
  }

  updateConfig(config: Partial<InjectionProtectionConfig>): void {
    const oldPatterns = this.config.customPatterns
    this.config = { ...this.config, ...config }

    if (config.customPatterns !== oldPatterns) {
      if (
        this.config.customPatterns &&
        this.config.customPatterns.length > 0
      ) {
        const validPatterns = this.config.customPatterns
          .filter((p) => isValidInjectionPattern(p.pattern))
          .map((p) => ({
            type: 'custom' as const,
            pattern: new RegExp(p.pattern, 'i'),
            description: p.description || 'Custom injection pattern',
          }))
        if (validPatterns.length > 0) {
          this.probe = new InjectionProbe(validPatterns)
        } else {
          this.probe = new InjectionProbe()
        }
      } else {
        this.probe = new InjectionProbe()
      }
    }
  }
}
