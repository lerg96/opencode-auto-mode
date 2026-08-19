export type ClassificationDecision = 'allow' | 'deny' | 'escalate'

export interface ClassificationResult {
  decision: ClassificationDecision
  reasoning: string
  blockRule?: string
  stage: 1 | 2 | 'rule-eval'
  timestamp: Date
}
