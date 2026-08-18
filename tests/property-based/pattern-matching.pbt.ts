import fc from 'fast-check'
import { PatternMatcher } from '../../src/rules/PatternMatcher'
import { ToolCall } from '../../src/types/ToolCall'
import { BlockRule, AllowException } from '../../src/types/RuleTypes'

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

function createBlockRule(overrides: Partial<BlockRule> = {}): BlockRule {
  return {
    id: 'BR-001',
    type: 'pattern',
    pattern: 'rm -rf',
    category: 'dangerous-command',
    description: 'Block dangerous rm command',
    severity: 'critical',
    enabled: true,
    ...overrides,
  }
}

function createAllowException(
  overrides: Partial<AllowException> = {}
): AllowException {
  return {
    id: 'AE-001',
    type: 'pattern',
    pattern: 'safe-cleanup',
    description: 'Allow safe cleanup',
    enabled: true,
    ...overrides,
  }
}

describe('PatternMatcher - Property Based Tests', () => {
  let matcher: PatternMatcher

  beforeEach(() => {
    matcher = new PatternMatcher()
  })

  // Arbitrary generators for fast-check
  const subStrPatternArb = fc
    .fullUnicodeString()
    .filter((s) => s.length > 0 && s.length < 80)
  const commandArb = fc
    .fullUnicodeString()
    .filter((s) => s.length > 0 && s.length < 200)

  const bashToolCallArb = fc.record({
    toolName: fc.constant('Bash' as any),
    arguments: fc.record({ command: commandArb }),
    context: fc.record({
      agentName: fc.string(),
      workingDirectory: fc.string(),
      sessionId: fc.string(),
    }),
  })

  const readToolCallArb = fc.record({
    toolName: fc.constant('Read' as any),
    arguments: fc.record({
      path: fc.fullUnicodeString().filter((s) => s.length > 0),
    }),
    context: fc.record({
      agentName: fc.string(),
      workingDirectory: fc.string(),
      sessionId: fc.string(),
    }),
  })

  const blockRuleArb = fc.record({
    id: fc.string().filter((s) => s.length > 0),
    type: fc.constant('pattern' as const),
    pattern: fc.oneof(
      fc.string().filter((s) => s.length > 0),
      fc.fullUnicodeString().filter((s) => s.length > 0)
    ),
    category: fc.string(),
    description: fc.string(),
    severity: fc.oneof(
      fc.constant('low'),
      fc.constant('medium'),
      fc.constant('high'),
      fc.constant('critical')
    ),
    enabled: fc.boolean(),
  })

  const allowExceptionArb = fc.record({
    id: fc.string().filter((s) => s.length > 0),
    type: fc.constant('pattern' as const),
    pattern: fc.oneof(
      fc.string().filter((s) => s.length > 0),
      fc.fullUnicodeString().filter((s) => s.length > 0)
    ),
    description: fc.string(),
    enabled: fc.boolean(),
  })

  describe('Determinism: regex matching is deterministic', () => {
    it('should always return the same matched result for a given regex pattern and command', () => {
      fc.assert(
        fc.property(bashToolCallArb, blockRuleArb, (toolCall, rule) => {
          if (rule.pattern.startsWith('regex:')) {
            const results: boolean[] = []
            for (let i = 0; i < 30; i++) {
              const result = matcher.match(toolCall, rule)
              results.push(result.matched)
            }
            const unique = new Set(results)
            expect(unique.size).toBe(1)
          }
        })
      )
    })
  })

  describe('Determinism: substring matching is deterministic', () => {
    it('should always return the same matched result for a given substring pattern and command', () => {
      fc.assert(
        fc.property(bashToolCallArb, blockRuleArb, (toolCall, rule) => {
          if (!rule.pattern.startsWith('regex:')) {
            const results: boolean[] = []
            for (let i = 0; i < 30; i++) {
              const result = matcher.match(toolCall, rule)
              results.push(result.matched)
            }
            const unique = new Set(results)
            expect(unique.size).toBe(1)
          }
        })
      )
    })
  })

  describe('Determinism: exception matching is deterministic', () => {
    it('should always return the same match result for a given exception and tool call', () => {
      fc.assert(
        fc.property(
          bashToolCallArb,
          allowExceptionArb,
          (toolCall, exception) => {
            const results: boolean[] = []
            for (let i = 0; i < 30; i++) {
              const result = matcher.matchException(toolCall, exception)
              results.push(result)
            }
            const unique = new Set(results)
            expect(unique.size).toBe(1)
          }
        )
      )
    })
  })

  describe('Correctness: substring match works for matching patterns', () => {
    it('should match when the command contains the pattern as a substring', () => {
      fc.assert(
        fc.property(subStrPatternArb, commandArb, (pattern, command) => {
          const fullCommand = `${pattern} extra args`
          const toolCall = createToolCall({
            arguments: { command: fullCommand },
          })
          const rule = createBlockRule({ pattern })
          const result = matcher.match(toolCall, rule)

          expect(result.matched).toBe(true)
          expect(result.confidence).toBe('high')
        })
      )
    })
  })

  describe('Correctness: substring match fails when not present', () => {
    it('should not match when the pattern is not a substring of the command', () => {
      fc.assert(
        fc.property(
          subStrPatternArb,
          subStrPatternArb,
          (patternA, patternB) => {
            if (!patternB.includes(patternA)) {
              const toolCall = createToolCall({
                arguments: { command: patternB },
              })
              const rule = createBlockRule({ pattern: patternA })
              const result = matcher.match(toolCall, rule)
              expect(result.matched).toBe(false)
            }
          }
        )
      )
    })
  })

  describe('Correctness: disabled rule never matches', () => {
    it('should never match when rule is disabled regardless of pattern/command combination', () => {
      fc.assert(
        fc.property(bashToolCallArb, subStrPatternArb, (toolCall, pattern) => {
          const rule = createBlockRule({ pattern, enabled: false })
          const result = matcher.match(toolCall, rule)
          expect(result.matched).toBe(false)
          expect(result.confidence).toBe('low')
        })
      )
    })
  })

  describe('Correctness: regex match on file path', () => {
    it('should match regex patterns in file path for Read/Write tools', () => {
      const safeSegmentArb = fc
        .fullUnicodeString()
        .filter(
          (s) => /^[a-zA-Z0-9/_.~-]+$/.test(s) && s.length > 0 && s.length < 50
        )
      fc.assert(
        fc.property(
          readToolCallArb,
          safeSegmentArb,
          (toolCall, filePathSegment) => {
            const fullFilePath = `/tmp/${filePathSegment}`
            const toolCallWithPath = createToolCall({
              toolName: 'Read' as any,
              arguments: { path: fullFilePath },
            })
            const rule = createBlockRule({
              pattern: `regex:${filePathSegment}`,
            })
            const result = matcher.match(toolCallWithPath, rule)
            expect(result.matched).toBe(true)
            expect(result.confidence).toBe('high')
          }
        )
      )
    })
  })

  describe('Correctness: match returns high confidence for matches', () => {
    it('should always return high confidence when the command contains the pattern', () => {
      fc.assert(
        fc.property(subStrPatternArb, commandArb, (pattern, command) => {
          if (command.includes(pattern)) {
            const toolCall = createToolCall({ arguments: { command } })
            const rule = createBlockRule({ pattern })
            const result = matcher.match(toolCall, rule)
            expect(result.confidence).toBe('high')
          }
        })
      )
    })
  })

  describe('Correctness: exception matches on file path', () => {
    it('should match exceptions in file path', () => {
      fc.assert(
        fc.property(subStrPatternArb, (pattern) => {
          const filePath = `/var/log/${pattern}.log`
          const toolCall = createToolCall({
            toolName: 'Read' as any,
            arguments: { path: filePath },
          })
          const exception = createAllowException({ pattern })
          const result = matcher.matchException(toolCall, exception)
          expect(result).toBe(true)
        })
      )
    })
  })
})
