export type RuleType = 'pattern' | 'semantic'
export type MatchConfidence = 'high' | 'medium' | 'low'
export type RuleSeverity = 'low' | 'medium' | 'high' | 'critical'
export type RuleEvaluationResultType = 'blocked' | 'allowed' | 'uncertain'

export interface BlockRule {
  id: string
  type: RuleType
  pattern: string
  category: string
  description: string
  severity: RuleSeverity
  enabled: boolean
}

export interface AllowException {
  id: string
  type: 'pattern'
  pattern: string
  description: string
  enabled: boolean
}

export interface PatternMatchResult {
  matched: boolean
  confidence: MatchConfidence
  ruleId?: string
}

export interface RuleEvaluationResult {
  evaluation: RuleEvaluationResultType
  matchedRule?: string
  matchedException?: string
  reasoning?: string
}

export function isCriticalRule(rule: BlockRule): boolean {
  return rule.severity === 'critical'
}
