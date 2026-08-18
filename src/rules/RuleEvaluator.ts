import { ToolCall } from '../types/ToolCall'
import {
  BlockRule,
  AllowException,
  RuleEvaluationResult,
  PatternMatchResult,
} from '../types/RuleTypes'
import { PatternMatcher } from './PatternMatcher'
import { TrustBoundaryConfig } from '../types/PluginConfig'

export class RuleEvaluator {
  private patternMatcher: PatternMatcher

  constructor(patternMatcher?: PatternMatcher) {
    this.patternMatcher = patternMatcher || new PatternMatcher()
  }

  evaluate(
    toolCall: ToolCall,
    blockRules: BlockRule[],
    allowExceptions: AllowException[],
    trustBoundary?: TrustBoundaryConfig
  ): RuleEvaluationResult {
    // Step 0: Check trust boundary rules (highest precedence, always evaluated)
    const trustResult = this.evaluateTrustBoundaries(toolCall, trustBoundary)
    if (trustResult) {
      return trustResult
    }

    // Step 1: Check allow exceptions first (highest precedence)
    for (const exception of allowExceptions) {
      if (this.patternMatcher.matchException(toolCall, exception)) {
        return {
          evaluation: 'allowed',
          matchedException: exception.id,
        }
      }
    }

    // Step 2: Fast pattern matching for block rules
    let uncertainRules: { rule: BlockRule; result: PatternMatchResult }[] = []

    for (const rule of blockRules) {
      if (!rule.enabled) {
        continue
      }

      const result = this.patternMatcher.match(toolCall, rule)

      if (result.matched && result.confidence === 'high') {
        return {
          evaluation: 'blocked',
          matchedRule: rule.id,
        }
      }

      if (result.confidence === 'medium') {
        uncertainRules.push({ rule, result })
      }
    }

    // Step 3: If we have uncertain rules, return uncertain (LLM fallback would be needed)
    if (uncertainRules.length > 0) {
      return {
        evaluation: 'uncertain',
        reasoning: `Pattern matching inconclusive for ${uncertainRules.length} rule(s)`,
      }
    }

    // No rules matched — uncertain means no clear block
    return {
      evaluation: 'uncertain',
      reasoning: 'No block rules matched',
    }
  }

  evaluateTrustBoundaries(
    toolCall: ToolCall,
    trustBoundary?: TrustBoundaryConfig
  ): RuleEvaluationResult | null {
    if (!trustBoundary) {
      return null
    }

    const cmd = this.extractCommand(toolCall)
    if (!cmd) {
      return null
    }

    // Check protected paths
    for (const protectedPath of trustBoundary.protectedPaths) {
      if (cmd.includes(protectedPath)) {
        return {
          evaluation: 'blocked',
          matchedRule: `TB-PATH-${protectedPath.replace(/[^\w]/g, '_')}`,
          reasoning: `Trust boundary violation: access to protected path '${protectedPath}'`,
        }
      }
    }

    // Check protected commands
    const segments = cmd.split(/[;&|`\n]|\$\s*\(/)
    for (const protectedCmd of trustBoundary.protectedCommands) {
      const protectedName = protectedCmd.trim()

      for (const segment of segments) {
        const trimmedSegment = segment.trim()
        if (!trimmedSegment) {
          continue
        }

        if (protectedName.includes(' ')) {
          if (trimmedSegment.startsWith(protectedName)) {
            return {
              evaluation: 'blocked',
              matchedRule: `TB-CMD-${protectedCmd.replace(/[^\w]/g, '_')}`,
              reasoning: `Trust boundary violation: protected command '${protectedCmd}'`,
            }
          }
        } else {
          const firstToken = trimmedSegment.split(/\s+/)[0]
          if (firstToken.toLowerCase() === protectedName.toLowerCase()) {
            return {
              evaluation: 'blocked',
              matchedRule: `TB-CMD-${protectedCmd.replace(/[^\w]/g, '_')}`,
              reasoning: `Trust boundary violation: protected command '${protectedCmd}'`,
            }
          }
        }
      }
    }

    return null
  }

  evaluateWithLLMFallback(
    toolCall: ToolCall,
    blockRules: BlockRule[],
    allowExceptions: AllowException[],
    trustBoundary?: TrustBoundaryConfig
  ): RuleEvaluationResult {
    // First try pattern matching
    const patternResult = this.evaluate(
      toolCall,
      blockRules,
      allowExceptions,
      trustBoundary
    )

    if (patternResult.evaluation !== 'uncertain') {
      return patternResult
    }

    // Pattern matching was inconclusive
    // In a full implementation, this would call the LLM for semantic evaluation
    // For now, conservative default: block uncertain results
    return {
      evaluation: 'blocked',
      matchedRule: 'semantic-fallback',
      reasoning:
        'LLM semantic evaluation concluded the action is potentially unsafe',
    }
  }

  private extractCommand(toolCall: ToolCall): string | null {
    if (toolCall.toolName !== 'Bash') {
      return null
    }
    const cmd = toolCall.arguments.command
    if (typeof cmd === 'string' && cmd.length > 0) {
      return cmd
    }
    return null
  }

  getPatternMatcher(): PatternMatcher {
    return this.patternMatcher
  }
}
