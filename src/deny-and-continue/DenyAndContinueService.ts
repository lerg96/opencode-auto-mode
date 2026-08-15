import { ClassificationResult } from '../types/ClassificationResult';
import { DenyAndContinueResult, DenyMode } from '../types/DenyAndContinueTypes';
import { SessionState } from '../state/SessionState';
import { PluginConfig } from '../types/PluginConfig';

interface DenyStrategy {
  handleDeny(classificationResult: ClassificationResult, config: PluginConfig, sessionState: SessionState): DenyAndContinueResult;
}

class AutoRetryStrategy implements DenyStrategy {
  handleDeny(classificationResult: ClassificationResult): DenyAndContinueResult {
    const ruleInfo = classificationResult.blockRule ? ` [${classificationResult.blockRule}]` : '';
    return {
      type: 'auto-retry' as const,
      message: `Action blocked by auto-mode rule${ruleInfo}. Reason: ${classificationResult.reasoning}. Please find a safer approach.`,
    };
  }
}

class AskUserStrategy implements DenyStrategy {
  handleDeny(classificationResult: ClassificationResult): DenyAndContinueResult {
    const ruleInfo = classificationResult.blockRule ? ` [${classificationResult.blockRule}]` : '';
    return {
      type: 'ask-user' as const,
      message: `Auto-mode blocked action${ruleInfo}. Reason: ${classificationResult.reasoning}. Approve or deny?`,
      requiresUserApproval: true,
    };
  }
}

class BothStrategy implements DenyStrategy {
  private autoRetryStrategy: AutoRetryStrategy;
  private askUserStrategy: AskUserStrategy;
  private escalationThreshold: number;

  constructor(escalationThreshold: number = 3) {
    this.autoRetryStrategy = new AutoRetryStrategy();
    this.askUserStrategy = new AskUserStrategy();
    this.escalationThreshold = escalationThreshold;
  }

  handleDeny(
    classificationResult: ClassificationResult,
    _config: PluginConfig,
    sessionState: SessionState
  ): DenyAndContinueResult {
    const counters = sessionState.getDenialCounters();

    if (counters.consecutive >= this.escalationThreshold) {
      return this.askUserStrategy.handleDeny(classificationResult);
    }

    return this.autoRetryStrategy.handleDeny(classificationResult);
  }
}

export class DenyAndContinueService {
  private strategy: DenyStrategy;
  private sessionState: SessionState;
  private denyMode: DenyMode;
  private config: PluginConfig;

  constructor(config: PluginConfig, sessionState: SessionState) {
    this.sessionState = sessionState;
    this.denyMode = config.denyMode;
    this.config = config;

    switch (this.denyMode) {
      case 'auto-retry':
        this.strategy = new AutoRetryStrategy();
        break;
      case 'ask-user':
        this.strategy = new AskUserStrategy();
        break;
      case 'both':
        this.strategy = new BothStrategy(
          this.config.escalation.consecutive
        );
        break;
      default:
        this.strategy = new AutoRetryStrategy();
    }
  }

  async handleDeny(classificationResult: ClassificationResult): Promise<DenyAndContinueResult> {
    return this.strategy.handleDeny(classificationResult, this.getEffectiveConfig(), this.sessionState);
  }

  getDenyMode(): DenyMode {
    return this.denyMode;
  }

  setDenyMode(mode: DenyMode): void {
    this.denyMode = mode;
    switch (this.denyMode) {
      case 'auto-retry':
        this.strategy = new AutoRetryStrategy();
        break;
      case 'ask-user':
        this.strategy = new AskUserStrategy();
        break;
      case 'both':
        this.strategy = new BothStrategy(
          this.config.escalation.consecutive
        );
        break;
    }
  }

  private getEffectiveConfig(): PluginConfig {
    return this.config;
  }
}
