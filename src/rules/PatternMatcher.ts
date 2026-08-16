import {
  ToolCall,
  extractCommand,
  extractFilePath,
  matchesPattern,
} from '../types/ToolCall'
import { PatternMatchResult, MatchConfidence } from '../types/RuleTypes'
import { BlockRule, AllowException } from '../types/RuleTypes'

const MAX_PATTERN_LENGTH = 200
const SUSPICIOUS_LENGTH_THRESHOLD = 100

const QUANTIFIER_RE = /[+*()]/g

function isSuspiciousPattern(pattern: string): boolean {
  if (pattern.length <= SUSPICIOUS_LENGTH_THRESHOLD) {
    return false
  }
  const quantifiers = pattern.match(QUANTIFIER_RE)
  return quantifiers ? quantifiers.length >= 2 : false
}

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
    if (pattern.length > MAX_PATTERN_LENGTH) {
      console.warn(
        `[auto-mode] Pattern "${pattern.slice(0, 50)}..." exceeds max length (${MAX_PATTERN_LENGTH} chars) — rejected for ReDoS safety`
      )
      return 'low'
    }
    if (isSuspiciousPattern(pattern)) {
      console.warn(
        `[auto-mode] Pattern matching ReDoS vulnerability (length ${pattern.length}, ${pattern.match(QUANTIFIER_RE)?.length || 0} quantifiers) — matching with reduced confidence`
      )
    }
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
    if (pattern.length > MAX_PATTERN_LENGTH) {
      return false
    }
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
