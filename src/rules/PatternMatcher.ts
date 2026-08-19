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
const SHELL_SEPARATOR_RE = /[;|`\n]|\$\s*\(|<\(|(?<![<>\d])&(?![>])/

const NESTED_QUANTIFIER_RE = /\([^()]*[+*?][^()]*\)\s*[+*?{]/
const REPEATED_ALTERNATION_RE = /\([^)]*\|[^)]*\)\s*[+*?{]/

function isSuspiciousPattern(pattern: string): boolean {
  if (
    NESTED_QUANTIFIER_RE.test(pattern) ||
    REPEATED_ALTERNATION_RE.test(pattern)
  ) {
    return true
  }
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

    if (cmd) {
      // An allow exception only exempts a compound command when it covers
      // every segment. Otherwise a pattern like `git push --force-with-lease`
      // would exempt `git push --force-with-lease && git push --force origin main`.
      const segments = cmd.split(SHELL_SEPARATOR_RE)
      let coveredSegment = false
      for (const segment of segments) {
        if (!segment.trim()) {
          continue
        }
        coveredSegment = true
        const matched = exception.pattern.startsWith('regex:')
          ? this.regexMatches(segment, null, exception.pattern.slice(6))
          : this.substringMatches(segment, null, exception.pattern)
        if (!matched) {
          return false
        }
      }
      if (coveredSegment) {
        return true
      }
      // If no segment matched, don't fall through to full-command matching
      // for compound commands — it creates an allow-exception bypass
    }

    if (filePath) {
      if (exception.pattern.startsWith('regex:')) {
        return this.regexMatches(null, filePath, exception.pattern.slice(6))
      }
      return this.substringMatches(null, filePath, exception.pattern)
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
        `[auto-mode] Pattern matching ReDoS vulnerability (length ${pattern.length}, ${pattern.match(QUANTIFIER_RE)?.length || 0} quantifiers) — rejected`
      )
      return 'low'
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
    // NOTE on glob semantics: `*` in a regex pattern matches ANY character,
    // including `/`.  This means a pattern like `*/secret/*` as an
    // allow-exception will match `/a/b/secret/c/d` (crossing path
    // boundaries).  In allow-exception contexts, prefer `[^/]*` instead of
    // `*` to restrict matching to within a single path component:
    //   `regex:[^/]*secret/[^/]*`  instead of  `regex:*/secret/*`
    // This is intentional — allow-exception patterns are user-provided regex.
    if (pattern.length > MAX_PATTERN_LENGTH) {
      return false
    }
    if (isSuspiciousPattern(pattern)) {
      console.warn(
        `[auto-mode] Exception pattern matching ReDoS vulnerability (length ${pattern.length}, ${pattern.match(QUANTIFIER_RE)?.length || 0} quantifiers) — rejected`
      )
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
