import { InjectionProbe } from './InjectionProbe'
import { InjectionResult } from './types'

export interface InjectionProtectionConfig {
  enabled: boolean
  scanToolResults: boolean
  scanUserMessages: boolean
  customPatterns?: Array<{ pattern: string; description: string }>
}

const MAX_PATTERN_LENGTH = 500
// Bounds the sessionsScanned map so it cannot grow unbounded if sessions are
// deleted without emitting a session.deleted event (see resetSession).
const MAX_SCANNED_SESSIONS = 200
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
  scanUserMessages: false,
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
      this.sessionsScanned.delete(sessionId)
      this.sessionsScanned.set(sessionId, count + 1)
      if (this.sessionsScanned.size > MAX_SCANNED_SESSIONS) {
        const oldest = this.sessionsScanned.keys().next().value
        if (oldest !== undefined) this.sessionsScanned.delete(oldest)
      }
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
