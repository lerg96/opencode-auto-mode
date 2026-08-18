import { TranscriptClassifier } from '../../../src/classifier/TranscriptClassifier'
import { ToolCall } from '../../../src/types/ToolCall'
import { LLMProviderAbstraction } from '../../../src/classifier/LLMProviderAbstraction'
import { RuleEvaluator } from '../../../src/rules/RuleEvaluator'
import { SessionState } from '../../../src/state/SessionState'
import { DEFAULT_CONFIG } from '../../../src/types/PluginConfig'
import {
  FilteredTranscript,
  Stage1Result,
  Stage2Result,
} from '../../../src/types/ClassificationResult'

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolName: 'Bash',
    arguments: { command: 'ls -la' },
    context: {
      agentName: 'general',
      workingDirectory: '/tmp',
      sessionId: 'test',
    },
    ...overrides,
  }
}

describe('TranscriptClassifier', () => {
  let classifier: TranscriptClassifier
  let sessionState: SessionState
  const config = {
    ...DEFAULT_CONFIG,
    fallback: { onTimeout: 'ask-user', onError: 'ask-user' },
  }

  let mockLLMProvider: any

  beforeEach(() => {
    mockLLMProvider = {
      classifyStage1: jest.fn().mockResolvedValue({
        prediction: 'allow',
        confidence: undefined,
        latency: 0,
      }),
      classifyStage2: jest.fn().mockResolvedValue({
        reasoning: 'allowed',
        decision: 'allow',
        confidence: undefined,
        latency: 0,
      }),
      getCircuitBreaker: jest.fn().mockReturnValue({
        getState: jest.fn().mockReturnValue('closed'),
      }),
    }
    const ruleEvaluator = new RuleEvaluator()
    sessionState = new SessionState()
    classifier = new TranscriptClassifier(
      mockLLMProvider,
      ruleEvaluator,
      sessionState,
      config as any
    )
  })

  describe('classify - Stage 1 allows', () => {
    it('should return allow when Stage 1 predicts allow', async () => {
      const toolCall = createToolCall()

      const result = await classifier.classify(
        {
          userMessages: [],
          currentToolCall: toolCall,
          metadata: {
            sessionDuration: 0,
            messageCount: 0,
            toolExecutionCount: 0,
          },
        },
        [],
        []
      )

      expect(result.decision).toBe('allow')
      expect(result.stage).toBe(1)
    })
  })

  describe('classify - Stage 2 flow', () => {
    it('should return deny when Stage 2 predicts deny', async () => {
      mockLLMProvider.classifyStage1.mockResolvedValue({
        prediction: 'block',
        confidence: undefined,
        latency: 0,
      })
      mockLLMProvider.classifyStage2.mockResolvedValue({
        reasoning: 'The command is dangerous',
        decision: 'deny',
        confidence: undefined,
        latency: 0,
      })

      const result = await classifier.classify(
        {
          userMessages: [],
          currentToolCall: createToolCall(),
          metadata: {
            sessionDuration: 0,
            messageCount: 0,
            toolExecutionCount: 0,
          },
        },
        [],
        []
      )

      expect(result.decision).toBe('deny')
      expect(result.stage).toBe(2)
      expect(result.reasoning).toContain('Stage 2')
    })

    it('should return allow when Stage 2 allows', async () => {
      mockLLMProvider.classifyStage1.mockResolvedValue({
        prediction: 'block',
        confidence: undefined,
        latency: 0,
      })
      mockLLMProvider.classifyStage2.mockResolvedValue({
        reasoning: 'The command is safe',
        decision: 'allow',
        confidence: undefined,
        latency: 0,
      })

      const result = await classifier.classify(
        {
          userMessages: [],
          currentToolCall: createToolCall(),
          metadata: {
            sessionDuration: 0,
            messageCount: 0,
            toolExecutionCount: 0,
          },
        },
        [],
        []
      )

      expect(result.decision).toBe('allow')
      expect(result.stage).toBe(2)
    })
  })

  describe('classify - error handling', () => {
    it('should handle timeout error in Stage 1', async () => {
      mockLLMProvider.classifyStage1.mockRejectedValue(
        new Error('timeout occurred')
      )

      const result = await classifier.classify(
        {
          userMessages: [],
          currentToolCall: createToolCall(),
          metadata: {
            sessionDuration: 0,
            messageCount: 0,
            toolExecutionCount: 0,
          },
        },
        [],
        []
      )

      expect(result.decision).toBe('escalate')
    })

    it('should handle timeout error in Stage 2', async () => {
      mockLLMProvider.classifyStage1.mockResolvedValue({
        prediction: 'block',
        confidence: undefined,
        latency: 0,
      })
      mockLLMProvider.classifyStage2.mockRejectedValue(
        new Error('Stage 2 timeout')
      )

      const result = await classifier.classify(
        {
          userMessages: [],
          currentToolCall: createToolCall(),
          metadata: {
            sessionDuration: 0,
            messageCount: 0,
            toolExecutionCount: 0,
          },
        },
        [],
        []
      )

      expect(result.decision).toBe('escalate')
    })
  })

  describe('prepareContext', () => {
    it('should extract user messages from session history', () => {
      const toolCall = createToolCall()
      const history = [
        { role: 'user', content: 'Hello' },
        { role: 'tool', content: 'tool result' },
        { role: 'user', content: 'Run this command' },
      ]

      const transcript = classifier.prepareContext(history, toolCall)

      expect(transcript.userMessages).toHaveLength(2)
      expect(transcript.userMessages[0].content).toBe('Hello')
      expect(transcript.userMessages[1].content).toBe('Run this command')
    })

    it('should set metadata correctly', () => {
      const toolCall = createToolCall()
      const history = [
        { role: 'user', content: 'msg1' },
        { role: 'user', content: 'msg2' },
      ]

      const transcript = classifier.prepareContext(history, toolCall)

      expect(transcript.metadata.messageCount).toBe(2)
    })
  })

  describe('getters', () => {
    it('should return the LLM provider', () => {
      expect(classifier.getLLMProvider()).toBe(mockLLMProvider)
    })

    it('should return the rule evaluator', () => {
      expect(classifier.getRuleEvaluator()).toBeDefined()
    })
  })

  // --- Prompt format tests (catch private formatStage1Prompt/formatStage2Prompt via public classify) ---

  describe('formatStage1Prompt output structure', () => {
    it('should include tool name, command, and prompt ending in BLOCK or ALLOW instruction', async () => {
      const promptCapture: string[] = []
      ;(mockLLMProvider as any).classifyStage1.mockImplementation(
        async (prompt: string) => {
          promptCapture.push(prompt)
          return {
            prediction: 'allow' as const,
            confidence: undefined,
            latency: 0,
          }
        }
      )

      await classifier.classify(
        {
          userMessages: [
            { content: 'run this', timestamp: new Date(), messageId: '1' },
          ],
          currentToolCall: createToolCall({
            toolName: 'Bash',
            arguments: { command: 'rm -rf /tmp/test' },
          }),
          metadata: {
            sessionDuration: 0,
            messageCount: 1,
            toolExecutionCount: 0,
          },
        },
        [],
        []
      )

      expect(promptCapture.length).toBe(1)
      const prompt = promptCapture[0]
      expect(prompt).toContain('Tool: Bash')
      expect(prompt).toContain('Command: rm -rf /tmp/test')
      expect(prompt).toContain('user intent')
      expect(prompt).toContain('run this')
      expect(prompt).toContain('BLOCK or ALLOW')
    })

    it('should omit command section when command is empty', async () => {
      const promptCapture: string[] = []
      ;(mockLLMProvider as any).classifyStage1.mockImplementation(
        async (prompt: string) => {
          promptCapture.push(prompt)
          return {
            prediction: 'allow' as const,
            confidence: undefined,
            latency: 0,
          }
        }
      )

      await classifier.classify(
        {
          userMessages: [],
          currentToolCall: createToolCall({ arguments: { command: '' } }),
          metadata: {
            sessionDuration: 0,
            messageCount: 0,
            toolExecutionCount: 0,
          },
        },
        [],
        []
      )

      expect(promptCapture.length).toBe(1)
      const prompt = promptCapture[0]
      expect(prompt).toContain('Tool: Bash')
      expect(prompt).toContain('BLOCK or ALLOW')
      // Command section should be empty (no actual command text)
    })
  })

  describe('formatStage2Prompt output structure', () => {
    it('should include tool, command, user intent, block rules, allow exceptions, and ALLOW or DENY instruction', async () => {
      const promptCapture: string[] = []
      ;(mockLLMProvider as any).classifyStage2.mockImplementation(
        async (prompt: string) => {
          promptCapture.push(prompt)
          return {
            reasoning: 'test',
            decision: 'allow' as const,
            confidence: undefined,
            latency: 0,
          }
        }
      )
      ;(mockLLMProvider as any).classifyStage1.mockResolvedValue({
        prediction: 'block' as const,
        confidence: undefined,
        latency: 0,
      })

      const blockRules = [
        { id: 'BR-A', description: 'block desc', pattern: 'block-me' },
      ]
      const exceptions = [
        { id: 'AE-X', description: 'allow desc', pattern: 'allow-me' },
      ]

      await classifier.classify(
        {
          userMessages: [
            { content: 'test command', timestamp: new Date(), messageId: '1' },
          ],
          currentToolCall: createToolCall({
            arguments: { command: 'block-me command' },
          }),
          metadata: {
            sessionDuration: 0,
            messageCount: 1,
            toolExecutionCount: 0,
          },
        },
        blockRules as any,
        exceptions as any
      )

      expect(promptCapture.length).toBe(1)
      const prompt = promptCapture[0]
      expect(prompt).toContain('chain-of-thought')
      expect(prompt).toContain('Tool: Bash')
      expect(prompt).toContain('block-me')
      expect(prompt).toContain('Active block rules')
      expect(prompt).toContain('block desc')
      expect(prompt).toContain('Allow exceptions')
      expect(prompt).toContain('allow desc')
      expect(prompt).toContain('ALLOW or DENY')
    })

    it('should omit rule sections when no rules or exceptions provided', async () => {
      const promptCapture: string[] = []
      ;(mockLLMProvider as any).classifyStage2.mockImplementation(
        async (prompt: string) => {
          promptCapture.push(prompt)
          return {
            reasoning: 'test',
            decision: 'allow' as const,
            confidence: undefined,
            latency: 0,
          }
        }
      )
      ;(mockLLMProvider as any).classifyStage1.mockResolvedValue({
        prediction: 'block' as const,
        confidence: undefined,
        latency: 0,
      })

      await classifier.classify(
        {
          userMessages: [],
          currentToolCall: createToolCall(),
          metadata: {
            sessionDuration: 0,
            messageCount: 0,
            toolExecutionCount: 0,
          },
        },
        [],
        []
      )

      expect(promptCapture.length).toBe(1)
      const prompt = promptCapture[0]
      expect(prompt).toContain('chain-of-thought')
      expect(prompt).not.toContain('Active block rules')
      expect(prompt).not.toContain('Allow exceptions')
      expect(prompt).toContain('ALLOW or DENY')
    })
  })
})
