import {
  ToolCall,
  extractCommand,
  extractFilePath,
  matchesPattern,
} from '../types/ToolCall'
import { PatternMatchResult, MatchConfidence } from '../types/RuleTypes'
import { BlockRule, AllowException } from '../types/RuleTypes'

export class PatternMatcher {
  match(toolCall: ToolCall, rule: BlockRule): PatternMatchResult {
    if (!rule.enabled) {
      return { matched: false, confidence: 'low' }
    }

    const cmd = extractCommand(toolCall)
    const filePath = extractFilePath(toolCall)

    let confidence: MatchConfidence = 'low'

    if (rule.type === 'pattern') {
      if (rule.pattern.startsWith('regex:')) {
        const pattern = rule.pattern.slice(6)
        confidence = this.matchRegex(cmd, filePath, pattern)
      } else {
        confidence = this.matchSubstring(cmd, filePath, rule.pattern)
      }
    }

    if (confidence === 'high') {
      return { matched: true, confidence: 'high', ruleId: rule.id }
    } else if (confidence === 'medium') {
      return { matched: false, confidence: 'medium', ruleId: rule.id }
    }

    return { matched: false, confidence: 'low' }
  }

  matchException(toolCall: ToolCall, exception: AllowException): boolean {
    if (!exception.enabled) {
      return false
    }

    const cmd = extractCommand(toolCall)
    const filePath = extractFilePath(toolCall)

    if (exception.pattern.startsWith('regex:')) {
      const pattern = exception.pattern.slice(6)
      if (this.regexMatches(cmd, filePath, pattern)) {
        return true
      }
    } else {
      if (this.substringMatches(cmd, filePath, exception.pattern)) {
        return true
      }
    }

    return false
  }

  private matchRegex(
    cmd: string | null,
    filePath: string | null,
    pattern: string
  ): MatchConfidence {
    try {
      const regex = new RegExp(pattern, 'i')
      if (cmd && regex.test(cmd)) {
        return 'high'
      }
      if (filePath && regex.test(filePath)) {
        return 'high'
      }
      return 'low'
    } catch {
      return 'low'
    }
  }

  private matchSubstring(
    cmd: string | null,
    filePath: string | null,
    pattern: string
  ): MatchConfidence {
    if (cmd && cmd.includes(pattern)) {
      return 'high'
    }
    if (filePath && filePath.includes(pattern)) {
      return 'high'
    }
    return 'low'
  }

  private regexMatches(
    cmd: string | null,
    filePath: string | null,
    pattern: string
  ): boolean {
    try {
      const regex = new RegExp(pattern, 'i')
      if (cmd && regex.test(cmd)) {
        return true
      }
      if (filePath && regex.test(filePath)) {
        return true
      }
    } catch {
      return false
    }
    return false
  }

  private substringMatches(
    cmd: string | null,
    filePath: string | null,
    pattern: string
  ): boolean {
    if (cmd && cmd.includes(pattern)) {
      return true
    }
    if (filePath && filePath.includes(pattern)) {
      return true
    }
    return false
  }

  matchCommandStructure(
    toolCall: ToolCall,
    commandName: string,
    flags?: string[]
  ): boolean {
    const cmd = extractCommand(toolCall)
    if (!cmd) {
      return false
    }

    const parts = cmd.trim().split(/\s+/)
    if (parts[0] !== commandName) {
      return false
    }

    if (flags && flags.length > 0) {
      return flags.some((flag) => cmd.includes(flag))
    }

    return true
  }
}
