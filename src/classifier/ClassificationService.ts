// @ts-ignore — dead code, will be removed in next major
/* DEAD CODE — duplicate of plugin.ts flow. Use LlmClient.ts + callLLMWithModelFallback instead. */
import { ToolCall } from '../types/ToolCall'
import {
  ClassificationResult,
  FilteredTranscript,
} from '../types/ClassificationResult'
import { BlockRule, AllowException } from '../types/RuleTypes'
import { PermissionPreChecker } from '../permissions/PermissionPreChecker'
import { TranscriptClassifier } from './TranscriptClassifier'
import { SessionState } from '../state/SessionState'
import { EscalationService } from '../escalation/EscalationService'
import { PluginConfig } from '../types/PluginConfig'
import { InjectionProtectionService } from '../injection/InjectionProtectionService'
import { RuleEvaluator } from '../rules/RuleEvaluator'

export class ClassificationService {
  private permissionPreChecker: PermissionPreChecker
  private transcriptClassifier: TranscriptClassifier
  private sessionState: SessionState
  private escalationService: EscalationService
  private ruleEvaluator: RuleEvaluator
  private config: PluginConfig
  private sessionHistory: Array<{ role: string; content: string }>
  private injectionProtectionService: InjectionProtectionService

  constructor(
    permissionPreChecker: PermissionPreChecker,
    transcriptClassifier: TranscriptClassifier,
    sessionState: SessionState,
    escalationService: EscalationService,
    ruleEvaluator: RuleEvaluator,
    config: PluginConfig,
    injectionProtectionService?: InjectionProtectionService
  ) {
    this.permissionPreChecker = permissionPreChecker
    this.transcriptClassifier = transcriptClassifier
    this.sessionState = sessionState
    this.escalationService = escalationService
    this.ruleEvaluator = ruleEvaluator
    this.config = config
    this.sessionHistory = []
    this.injectionProtectionService =
      injectionProtectionService || new InjectionProtectionService()
  }

  async classify(toolCall: ToolCall): Promise<ClassificationResult> {
    // Step 1: Check if agent is excluded from LLM classifier only
    const agentName = toolCall.context?.agentName || 'general'
    const agentExcluded = this.isAgentExcluded(agentName)

    // Step 2: Permission pre-check
    const permissionResult = this.permissionPreChecker.checkPermission(toolCall)
    if (permissionResult.allowed) {
      this.sessionHistory.push({
        role: 'user',
        content: `Tool execution: ${toolCall.toolName} — allowed by permission`,
      })
      return {
        decision: 'allow',
        reasoning: `Explicit permission: ${permissionResult.reason}`,
        stage: 1,
        timestamp: new Date(),
      }
    }

    // Step 3: If agent is excluded, skip LLM classifier but still evaluate block rules
    if (agentExcluded) {
      const ruleResult = this.ruleEvaluator.evaluate(
        toolCall,
        this.config.blockRules as BlockRule[],
        this.config.allowExceptions as AllowException[],
        this.config.trustBoundary
      )

      // Update session state
      if (ruleResult.evaluation === 'blocked') {
        this.sessionState.incrementDenial(
          toolCall,
          ruleResult.reasoning || 'Blocked by rule'
        )
        this.escalationService.checkThresholds()

        return {
          decision: 'deny',
          reasoning: `Agent '${agentName}' excluded from LLM classifier — blocked by rule: ${ruleResult.reasoning || 'trust boundary'}`,
          stage: 'rule-eval',
          blockRule: ruleResult.matchedRule || '',
          timestamp: new Date(),
        }
      }

      return {
        decision: 'allow',
        reasoning: `Agent '${agentName}' excluded from LLM classifier — allowed by rule evaluation`,
        stage: 'rule-eval',
        timestamp: new Date(),
      }
    }

    // Step 4: Prepare context and classify with LLM
    const transcript = this.transcriptClassifier.prepareContext(
      this.sessionHistory,
      toolCall
    )

    const result = await this.transcriptClassifier.classify(
      transcript,
      this.config.blockRules as BlockRule[],
      this.config.allowExceptions as AllowException[]
    )

    // Add to session history
    const cmd = (toolCall.arguments.command as string) || ''
    this.sessionHistory.push({
      role: 'user',
      content: `Tool execution: ${toolCall.toolName}${cmd ? ` — ${cmd}` : ''}`,
    })

    // Step 5: Update session state and check escalation thresholds
    if (result.decision === 'deny') {
      this.sessionState.incrementDenial(toolCall, result.reasoning || 'Denied')
      const escalationResult = this.escalationService.checkThresholds()
      if (escalationResult.escalated) {
        return {
          decision: 'escalate',
          reasoning: escalationResult.message || 'Escalation threshold reached',
          blockRule: result.blockRule,
          stage: result.stage,
          timestamp: new Date(),
        }
      }
    } else if (result.decision === 'allow') {
      this.sessionState.incrementAllow(toolCall, result.reasoning || 'Allowed')
    }

    return result
  }

  scanToolResult(
    toolResult: string,
    sessionId?: string
  ): Promise<{ injectionDetected: boolean }> {
    return this.injectionProtectionService.scanToolResult(toolResult, sessionId)
  }

  updateSessionHistory(
    messages: Array<{ role: string; content: string }>
  ): void {
    this.sessionHistory = messages
  }

  addSessionMessage(role: string, content: string): void {
    this.sessionHistory.push({ role, content })
  }

  isAgentExcluded(agentName: string): boolean {
    return this.config.excludedAgents.includes(agentName)
  }

  clearSessionHistory(): void {
    this.sessionHistory = []
  }

  getSessionState(): SessionState {
    return this.sessionState
  }

  getConfig(): PluginConfig {
    return this.config
  }
}
