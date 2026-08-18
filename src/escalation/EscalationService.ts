import { SessionState } from '../state/SessionState'
import { EscalationResult } from '../types/EscalationTypes'
import { PluginConfig } from '../types/PluginConfig'
import { ToolCall } from '../types/ToolCall'

export class EscalationService {
  private sessionState: SessionState
  private config: PluginConfig

  constructor(sessionState: SessionState, config: PluginConfig) {
    this.sessionState = sessionState
    this.config = config
  }

  checkThresholds(): EscalationResult {
    const counters = this.sessionState.getDenialCounters()

    const consecutiveHit =
      counters.consecutive >= this.config.escalation.consecutive
    const totalHit = counters.total >= this.config.escalation.total

    if (consecutiveHit && totalHit) {
      return this.createEscalationResult(
        counters.consecutive,
        counters.total,
        'consecutive+total'
      )
    }

    if (consecutiveHit) {
      return this.createEscalationResult(
        counters.consecutive,
        counters.total,
        'consecutive'
      )
    }

    if (totalHit) {
      return this.createEscalationResult(
        counters.consecutive,
        counters.total,
        'total'
      )
    }

    return { escalated: false }
  }

  triggerEscalation(): EscalationResult {
    const counters = this.sessionState.getDenialCounters()
    return this.createEscalationResult(
      counters.consecutive,
      counters.total,
      'manual-trigger'
    )
  }

  processApproval(): void {
    this.sessionState.resetConsecutiveDenials()
  }

  processDenial(toolCall: ToolCall, reasoning: string): void {
    this.sessionState.incrementDenial(toolCall, reasoning)
  }

  getThresholds(): { consecutive: number; total: number } {
    return {
      consecutive: this.config.escalation.consecutive,
      total: this.config.escalation.total,
    }
  }

  setThresholds(consecutive: number, total: number): void {
    this.config.escalation.consecutive = consecutive
    this.config.escalation.total = total
  }

  private createEscalationResult(
    consecutive: number,
    total: number,
    trigger: string
  ): EscalationResult {
    return {
      escalated: true,
      message: `Auto-mode has blocked ${consecutive} consecutive actions (${total} total). Trigger: ${trigger}. Agent may be stuck. Please review and approve/deny.`,
    }
  }
}
