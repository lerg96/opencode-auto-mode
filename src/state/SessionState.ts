import { DenialCounters } from '../types/SessionTypes'
import {
  ClassificationDecisionRecord,
  createDecisionRecord,
} from '../types/SessionTypes'
import { extractCommand } from '../types/ToolCall'
import { ToolCall } from '../types/ToolCall'

const MAX_DECISION_HISTORY = 10

export class SessionState {
  private consecutiveDenials: number
  private totalDenials: number
  private recentDecisions: ClassificationDecisionRecord[]
  private lastDecisionWasDenial: boolean

  constructor() {
    this.consecutiveDenials = 0
    this.totalDenials = 0
    this.recentDecisions = []
    this.lastDecisionWasDenial = false
  }

  incrementDenial(
    toolCall: ToolCall,
    reasoning: string,
    blockRule?: string,
    stage: 1 | 2 | 'rule-eval' = 1
  ): void {
    this.consecutiveDenials++
    this.totalDenials++
    this.lastDecisionWasDenial = true

    const command = extractCommand(toolCall)
    const record = createDecisionRecord(
      toolCall.toolName,
      command,
      'deny',
      reasoning,
      blockRule,
      stage
    )
    this.recentDecisions.push(record)

    if (this.recentDecisions.length > MAX_DECISION_HISTORY) {
      this.recentDecisions.shift()
    }
  }

  incrementAllow(
    toolCall: ToolCall,
    reasoning: string,
    stage: 1 | 2 | 'rule-eval' = 1
  ): void {
    this.consecutiveDenials = 0
    this.lastDecisionWasDenial = false

    const command = extractCommand(toolCall)
    const record = createDecisionRecord(
      toolCall.toolName,
      command,
      'allow',
      reasoning,
      undefined,
      stage
    )
    this.recentDecisions.push(record)

    if (this.recentDecisions.length > MAX_DECISION_HISTORY) {
      this.recentDecisions.shift()
    }
  }

  getDenialCounters(): DenialCounters {
    return {
      consecutive: this.consecutiveDenials,
      total: this.totalDenials,
    }
  }

  getRecentDecisions(limit?: number): ClassificationDecisionRecord[] {
    const count =
      limit !== undefined
        ? Math.min(limit, this.recentDecisions.length)
        : this.recentDecisions.length
    return this.recentDecisions.slice(-count)
  }

  getConsecutiveDenialCount(): number {
    return this.consecutiveDenials
  }

  getTotalDenialCount(): number {
    return this.totalDenials
  }

  clear(): void {
    this.consecutiveDenials = 0
    this.totalDenials = 0
    this.recentDecisions = []
    this.lastDecisionWasDenial = false
  }

  resetConsecutiveDenials(): void {
    this.consecutiveDenials = 0
  }

  resetTotalDenials(): void {
    this.totalDenials = 0
  }
}
