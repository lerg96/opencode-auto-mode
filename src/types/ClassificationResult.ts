import { ToolCall } from './ToolCall'

export type ClassificationDecision = 'allow' | 'deny' | 'escalate'

export interface ClassificationResult {
  decision: ClassificationDecision
  reasoning: string
  blockRule?: string
  stage: 1 | 2 | 'rule-eval'
  timestamp: Date
}

export function createAllowResult(
  reasoning: string,
  stage: 1 | 2 | 'rule-eval' = 1,
  blockRule?: string
): ClassificationResult {
  return {
    decision: 'allow',
    reasoning,
    blockRule,
    stage,
    timestamp: new Date(),
  }
}

export function createDenyResult(
  reasoning: string,
  blockRule?: string,
  stage: 1 | 2 | 'rule-eval' = 1
): ClassificationResult {
  return {
    decision: 'deny',
    reasoning,
    blockRule,
    stage,
    timestamp: new Date(),
  }
}

export function createEscalateResult(reasoning: string): ClassificationResult {
  return {
    decision: 'escalate',
    reasoning,
    stage: 2,
    timestamp: new Date(),
  }
}

export interface Stage1Result {
  prediction: 'block' | 'allow'
  confidence?: number
  latency: number
}

export interface Stage2Result {
  reasoning: string
  decision: 'allow' | 'deny'
  confidence?: number
  latency: number
}

export interface FilteredTranscript {
  userMessages: UserMessage[]
  currentToolCall: ToolCall
  metadata: TranscriptMetadata
}

export interface UserMessage {
  content: string
  timestamp: Date
  messageId: string
}

export interface TranscriptMetadata {
  sessionDuration: number
  messageCount: number
  toolExecutionCount: number
}
