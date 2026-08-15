import { SessionState } from '../state/SessionState';
import { EscalationResult } from '../types/EscalationTypes';
import { PluginConfig } from '../types/PluginConfig';

export class EscalationService {
  private sessionState: SessionState;
  private config: PluginConfig;

  constructor(sessionState: SessionState, config: PluginConfig) {
    this.sessionState = sessionState;
    this.config = config;
  }

  checkThresholds(): EscalationResult {
    const counters = this.sessionState.getDenialCounters();

    // Check consecutive threshold
    if (counters.consecutive >= this.config.escalation.consecutive) {
      return this.createEscalationResult(
        counters.consecutive,
        counters.total,
        'consecutive'
      );
    }

    // Check total threshold
    if (counters.total >= this.config.escalation.total) {
      return this.createEscalationResult(
        counters.consecutive,
        counters.total,
        'total'
      );
    }

    return { escalated: false };
  }

  triggerEscalation(): EscalationResult {
    const counters = this.sessionState.getDenialCounters();
    return this.createEscalationResult(
      counters.consecutive,
      counters.total,
      'manual-trigger'
    );
  }

  processApproval(): void {
    this.sessionState.resetConsecutiveDenials();
  }

  processDenial(): void {
    this.sessionState.resetConsecutiveDenials();
    this.sessionState.resetTotalDenials();
  }

  getThresholds(): { consecutive: number; total: number } {
    return {
      consecutive: this.config.escalation.consecutive,
      total: this.config.escalation.total,
    };
  }

  setThresholds(consecutive: number, total: number): void {
    this.config.escalation.consecutive = consecutive;
    this.config.escalation.total = total;
  }

  private createEscalationResult(
    consecutive: number,
    total: number,
    trigger: string
  ): EscalationResult {
    return {
      escalated: true,
      message: `Auto-mode has blocked ${consecutive} consecutive actions (${total} total). Trigger: ${trigger}. Agent may be stuck. Please review and approve/deny.`,
    };
  }
}
