import {
  InjectionPattern,
  InjectionResult,
  DEFAULT_INJECTION_PATTERNS,
  DEFAULT_EMBEDDED_COMMAND_PATTERNS,
} from './types'

export class InjectionProbe {
  private builtInPatterns: InjectionPattern[]
  private customPatterns: InjectionPattern[]

  constructor(customPatterns?: InjectionPattern[]) {
    this.builtInPatterns = [
      ...DEFAULT_INJECTION_PATTERNS,
      ...DEFAULT_EMBEDDED_COMMAND_PATTERNS,
    ]
    this.customPatterns = customPatterns || []
  }

  async scan(toolResult: string): Promise<InjectionResult> {
    if (
      !toolResult ||
      typeof toolResult !== 'string' ||
      toolResult.length === 0
    ) {
      return {
        injected: false,
        overrideDecision: 'proceed',
      }
    }

    const normalized = toolResult.replace(
      /[\u200b-\u200d\u2060\ufeff\u0000]/g,
      ' '
    )

    const allPatterns = [...this.builtInPatterns, ...this.customPatterns]

    for (const pattern of allPatterns) {
      pattern.pattern.lastIndex = 0
      if (pattern.pattern.test(normalized)) {
        return {
          injected: true,
          pattern: pattern.description,
          patternType: pattern.type,
          overrideDecision: 'manual-review',
        }
      }
    }

    return {
      injected: false,
      overrideDecision: 'proceed',
    }
  }

  addCustomPatterns(patterns: InjectionPattern[]): void {
    this.customPatterns.push(...patterns)
  }

  getBuiltInPatterns(): InjectionPattern[] {
    return [...this.builtInPatterns]
  }

  getCustomPatterns(): InjectionPattern[] {
    return [...this.customPatterns]
  }
}
