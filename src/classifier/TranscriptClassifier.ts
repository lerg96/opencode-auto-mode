// @ts-ignore — dead code, will be removed in next major
/* DEAD CODE — duplicate of plugin.ts flow. Use LlmClient.ts + callLLMWithModelFallback instead. */
import { ToolCall } from '../types/ToolCall'
import {
  FilteredTranscript,
  UserMessage,
  TranscriptMetadata,
  Stage1Result,
  Stage2Result,
  ClassificationResult,
  createAllowResult,
  createDenyResult,
  createEscalateResult,
} from '../types/ClassificationResult'
import { LLMProviderAbstraction } from './LLMProviderAbstraction'
import { RuleEvaluator } from '../rules/RuleEvaluator'
import {
  BlockRule,
  AllowException,
  RuleEvaluationResult,
} from '../types/RuleTypes'
import { SessionState } from '../state/SessionState'
import { PluginConfig } from '../types/PluginConfig'
import { FallbackExecutor } from './FallbackExecutor'

export class TranscriptClassifier {
  private llmProvider: LLMProviderAbstraction
  private ruleEvaluator: RuleEvaluator
  private fallbackExecutor: FallbackExecutor
  private sessionState: SessionState
  private config: PluginConfig

  constructor(
    llmProvider: LLMProviderAbstraction,
    ruleEvaluator: RuleEvaluator,
    sessionState: SessionState,
    config: PluginConfig,
    fallbackExecutor?: FallbackExecutor
  ) {
    this.llmProvider = llmProvider
    this.ruleEvaluator = ruleEvaluator
    this.sessionState = sessionState
    this.config = config
    this.fallbackExecutor = fallbackExecutor || new FallbackExecutor(config)
  }

  async classify(
    transcript: FilteredTranscript,
    blockRules: BlockRule[],
    allowExceptions: AllowException[]
  ): Promise<ClassificationResult> {
    try {
      // Stage 1: Fast single-token filter
      const stage1Prompt = this.formatStage1Prompt(transcript)
      let stage1Result: Stage1Result

      try {
        stage1Result = await this.llmProvider.classifyStage1(stage1Prompt)
      } catch (error) {
        return this.handleStage1Error(error)
      }

      if (stage1Result.prediction === 'allow') {
        this.sessionState.incrementAllow(
          transcript.currentToolCall,
          `Stage 1 fast filter: allowed`,
          1
        )
        return createAllowResult(`Stage 1 fast filter: action allowed`, 1)
      }

      // Stage 1 predicted block — proceed to Stage 2
      const stage2Prompt = this.formatStage2Prompt(
        transcript,
        blockRules,
        allowExceptions
      )
      let stage2Result: Stage2Result

      try {
        stage2Result = await this.llmProvider.classifyStage2(stage2Prompt)
      } catch (error) {
        return this.handleStage2Error(error)
      }

      // Rule evaluation for additional context
      const ruleResult = this.ruleEvaluator.evaluate(
        transcript.currentToolCall,
        blockRules,
        allowExceptions
      )

      if (
        stage2Result.decision === 'deny' ||
        ruleResult.evaluation === 'blocked'
      ) {
        const matchedRule =
          ruleResult.evaluation === 'blocked'
            ? ruleResult.matchedRule
            : undefined
        this.sessionState.incrementDenial(
          transcript.currentToolCall,
          `Stage 2: ${stage2Result.reasoning || 'denied by LLM'}`,
          matchedRule,
          2
        )
        return createDenyResult(
          `Stage 2 chain-of-thought: ${stage2Result.reasoning || 'denied by LLM'}`,
          matchedRule,
          2
        )
      }

      // Stage 2 allowed
      this.sessionState.incrementAllow(
        transcript.currentToolCall,
        `Stage 2 CoT: allowed`,
        2
      )
      return createAllowResult(
        `Stage 2 chain-of-thought: action allowed — ${stage2Result.reasoning}`,
        2
      )
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        return this.handleStage1Error(error)
      }
      if (error instanceof Error && error.message.includes('Circuit breaker')) {
        return this.fallbackExecutor.executeOnError(error)
      }
      return this.fallbackExecutor.executeOnError(
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  prepareContext(
    sessionHistory: Array<{ role: string; content: string }>,
    currentToolCall: ToolCall
  ): FilteredTranscript {
    const userMessages: UserMessage[] = []

    let lastToolIndex = -1
    for (let i = sessionHistory.length - 1; i >= 0; i--) {
      if (
        sessionHistory[i].role === 'tool' ||
        sessionHistory[i].role === 'tool_result'
      ) {
        lastToolIndex = i
        break
      }
    }

    const startFrom = lastToolIndex === -1 ? 0 : Math.max(0, lastToolIndex - 1)
    for (let i = startFrom; i < sessionHistory.length; i++) {
      if (sessionHistory[i].role === 'user') {
        userMessages.push({
          content: sessionHistory[i].content,
          timestamp: new Date(),
          messageId: `msg-${i}`,
        })
      }
    }

    return {
      userMessages,
      currentToolCall,
      metadata: {
        sessionDuration: 0,
        messageCount: sessionHistory.length,
        toolExecutionCount: lastToolIndex >= 0 ? lastToolIndex : 0,
      },
    }
  }

  private formatStage1Prompt(transcript: FilteredTranscript): string {
    const toolCall = transcript.currentToolCall
    const cmd = (toolCall.arguments.command as string) || ''

    let prompt = `You are a security classifier. Evaluate this tool call and predict whether to BLOCK or ALLOW.\n\n`
    prompt += `Tool: ${toolCall.toolName}\n`
    if (cmd) {
      prompt += `Command: ${cmd}\n`
    }

    if (transcript.userMessages.length > 0) {
      prompt += `\nRecent user intent:\n`
      for (const msg of transcript.userMessages.slice(-3)) {
        prompt += `- ${msg.content}\n`
      }
    }

    prompt += `\nRespond with a single word: BLOCK or ALLOW.`
    return prompt
  }

  private formatStage2Prompt(
    transcript: FilteredTranscript,
    blockRules: BlockRule[],
    allowExceptions: AllowException[]
  ): string {
    const toolCall = transcript.currentToolCall
    const cmd = (toolCall.arguments.command as string) || ''

    let prompt = `You are a security classifier performing chain-of-thought reasoning.\n\n`
    prompt += `Tool: ${toolCall.toolName}\n`
    if (cmd) {
      prompt += `Command: ${cmd}\n`
    }

    if (transcript.userMessages.length > 0) {
      prompt += `\nRecent user intent:\n`
      for (const msg of transcript.userMessages.slice(-3)) {
        prompt += `- ${msg.content}\n`
      }
    }

    if (blockRules.length > 0) {
      prompt += `\nActive block rules:\n`
      for (const rule of blockRules.slice(0, 10)) {
        prompt += `- ${rule.id}: ${rule.description} (pattern: ${rule.pattern})\n`
      }
    }

    if (allowExceptions.length > 0) {
      prompt += `\nAllow exceptions:\n`
      for (const exc of allowExceptions) {
        prompt += `- ${exc.id}: ${exc.description} (pattern: ${exc.pattern})\n`
      }
    }

    prompt += `\nProvide your reasoning, then conclude with ALLOW or DENY.`
    return prompt
  }

  private handleStage1Error(error: unknown): ClassificationResult {
    if (this.fallbackExecutor.isTimeoutError(error)) {
      return this.fallbackExecutor.executeOnTimeout(
        error instanceof Error ? error : new Error(String(error))
      )
    }
    return this.fallbackExecutor.executeOnError(
      error instanceof Error ? error : new Error(String(error))
    )
  }

  private handleStage2Error(error: unknown): ClassificationResult {
    if (this.fallbackExecutor.isTimeoutError(error)) {
      return this.fallbackExecutor.executeOnTimeout(
        error instanceof Error ? error : new Error(String(error))
      )
    }
    return this.fallbackExecutor.executeOnError(
      error instanceof Error ? error : new Error(String(error))
    )
  }

  getLLMProvider(): LLMProviderAbstraction {
    return this.llmProvider
  }

  getRuleEvaluator(): RuleEvaluator {
    return this.ruleEvaluator
  }
}
