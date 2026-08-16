import { ClassificationDecision } from './ClassificationResult'

export interface DenialCounters {
  consecutive: number
  total: number
}

export interface ClassificationDecisionRecord {
  toolCallName: string
  toolCommand: string | null
  decision: 'allow' | 'deny'
  reasoning: string
  blockRule?: string
  stage: 1 | 2 | 'rule-eval'
  timestamp: Date
}

export function createDecisionRecord(
  toolCallName: string,
  toolCommand: string | null,
  decision: 'allow' | 'deny',
  reasoning: string,
  blockRule?: string,
  stage: 1 | 2 | 'rule-eval' = 1
): ClassificationDecisionRecord {
  return {
    toolCallName,
    toolCommand,
    decision,
    reasoning,
    blockRule,
    stage,
    timestamp: new Date(),
  }
}
