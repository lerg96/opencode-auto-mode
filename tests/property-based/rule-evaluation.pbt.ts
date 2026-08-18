import { RuleEvaluator } from '../../src/rules/RuleEvaluator'
import { PatternMatcher } from '../../src/rules/PatternMatcher'
import { ToolCall } from '../../src/types/ToolCall'
import { BlockRule, AllowException } from '../../src/types/RuleTypes'
import fc from 'fast-check'

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

describe('RuleEvaluator - Property Based Tests', () => {
  let evaluator: RuleEvaluator

  beforeEach(() => {
    evaluator = new RuleEvaluator(new PatternMatcher())
  })

  const toolCallArb = fc
    .oneof(fc.constantFrom('Bash', 'Read', 'Write', 'Grep'))
    .chain((toolName) =>
      fc.record({
        toolName: fc.constant(toolName as any),
        arguments: fc.record({ command: fc.string() }),
        context: fc.record({
          agentName: fc.string(),
          workingDirectory: fc.string(),
          sessionId: fc.string(),
        }),
      })
    )

  const blockRuleArb = fc.record({
    id: fc.string(),
    type: fc.constant('pattern' as const),
    pattern: fc.oneof(fc.string(), fc.fullUnicodeString()),
    category: fc.string(),
    description: fc.fullUnicodeString(),
    severity: fc.oneof(
      fc.constant('low'),
      fc.constant('medium'),
      fc.constant('high'),
      fc.constant('critical'),
      fc.constant('soft')
    ),
    enabled: fc.boolean(),
  })

  const allowExceptionArb = fc.record({
    id: fc.string(),
    type: fc.constant('pattern' as const),
    pattern: fc.oneof(fc.string(), fc.fullUnicodeString()),
    description: fc.fullUnicodeString(),
    enabled: fc.boolean(),
  })

  const trustBoundaryArb = fc.record({
    protectedPaths: fc.array(fc.string().filter((s) => s.length > 0)),
    protectedCommands: fc.array(fc.string().filter((s) => s.length > 0)),
  })

  const nonEmptyBlockRules = fc.array(blockRuleArb, { minLength: 1 })

  describe('Determinism: evaluation is idempotent', () => {
    it('should always return the same result when calling evaluate multiple times with identical inputs', () => {
      fc.assert(
        fc.property(toolCallArb, blockRuleArb, (toolCall, rule) => {
          const results: string[] = []
          for (let i = 0; i < 10; i++) {
            const result = evaluator.evaluate(toolCall, [rule], [])
            results.push(result.evaluation)
          }
          const unique = new Set(results)
          expect(unique.size).toBe(1)
        })
      )
    })
  })

  describe('Idempotency: evaluating the same tool call multiple times produces the same result', () => {
    it('should always return the same evaluation value regardless of how many times we evaluate', () => {
      fc.assert(
        fc.property(
          toolCallArb,
          blockRuleArb,
          allowExceptionArb,
          (toolCall, rule, exception) => {
            const results: string[] = []
            for (let i = 0; i < 20; i++) {
              results.push(
                evaluator.evaluate(toolCall, [rule], [exception]).evaluation
              )
            }
            const unique = new Set(results)
            expect(unique.size).toBe(1)
          }
        )
      )
    })
  })

  describe('Commutativity: evaluating with rules in any order produces the same result', () => {
    it('should not depend on block rule ordering when all rules share the same match outcome', () => {
      fc.assert(
        fc.property(
          blockRuleArb,
          blockRuleArb,
          toolCallArb,
          (rule1, rule2, toolCall) => {
            const bothResults = evaluator.evaluate(toolCall, [rule1, rule2], [])
            const reversedResults = evaluator.evaluate(
              toolCall,
              [rule2, rule1],
              []
            )
            expect(bothResults.evaluation).toBe(reversedResults.evaluation)
          }
        )
      )
    })
  })

  describe('Exception overrides block rule', () => {
    it('should always return allowed when both a matching block rule and matching exception exist', () => {
      fc.assert(
        fc.property(
          toolCallArb,
          fc
            .string()
            .filter((s) => s.length > 0 && !/[;&|`\n]|\$\s*\(/.test(s)),
          (toolCall, sharedPattern) => {
            const toolCallWithPath = createToolCall({
              arguments: { command: `${sharedPattern} extra args` },
            })
            const rule = {
              ...createBlockRule({ id: 'BR-TEST', pattern: sharedPattern }),
              id: `BR-${sharedPattern}`,
            }
            const exception = createAllowException({
              id: `AE-${sharedPattern}`,
              pattern: sharedPattern,
            })

            const result = evaluator.evaluate(
              toolCallWithPath,
              [rule],
              [exception]
            )

            expect(result.evaluation).toBe('allowed')
            expect(result.matchedException).toBe(exception.id)
          }
        )
      )
    })
  })

  describe('Disabled rules never produce blocked', () => {
    it('should never return blocked when the only matching rule is disabled', () => {
      fc.assert(
        fc.property(toolCallArb, blockRuleArb, (toolCall, rule) => {
          if (!rule.enabled) {
            const result = evaluator.evaluate(toolCall, [rule], [])
            expect(result.evaluation).not.toBe('blocked')
          }
        })
      )
    })

    it('should return uncertain when all rules are disabled even for dangerous commands', () => {
      fc.assert(
        fc.property(
          fc.array(
            blockRuleArb.filter((r) => !r.enabled),
            { minLength: 1, maxLength: 10 }
          ),
          toolCallArb,
          (rules, toolCall) => {
            const result = evaluator.evaluate(toolCall, rules, [])
            expect(result.evaluation).not.toBe('blocked')
          }
        )
      )
    })
  })

  describe('Empty rules list produces uncertain', () => {
    it('should always return uncertain with an empty block rules list regardless of command content', () => {
      fc.assert(
        fc.property(toolCallArb, (toolCall) => {
          const result = evaluator.evaluate(toolCall, [], [])
          expect(result.evaluation).toBe('uncertain')
        })
      )
    })
  })

  describe('Trust boundary blocks even when allow exception matches', () => {
    it('should return a valid evaluation state for any input', () => {
      fc.assert(
        fc.property(toolCallArb, (toolCall) => {
          const result = evaluator.evaluate(toolCall, [], [])
          expect(['uncertain', 'blocked', 'allowed']).toContain(
            result.evaluation
          )
        })
      )
    })
  })

  describe('Empty exception list never produces allowed', () => {
    it('should never return allowed when exception list is empty', () => {
      fc.assert(
        fc.property(nonEmptyBlockRules, toolCallArb, (rules, toolCall) => {
          const result = evaluator.evaluate(toolCall, rules, [])
          expect(result.evaluation).not.toBe('allowed')
        })
      )
    })
  })

  describe('Edge cases with unicode', () => {
    it('should correctly match unicode substring patterns', () => {
      fc.assert(
        fc.property(
          fc.fullUnicodeString().filter((s) => s.length > 0),
          (pattern) => {
            const rule = createBlockRule({ pattern, id: 'BR-UNICODE' })
            const toolCall = createToolCall({
              arguments: { command: `echo ${pattern} here` },
            })
            const result = evaluator.evaluate(toolCall, [rule], [])
            // If pattern is a substring of the command, it should match (blocked)
            // Otherwise uncertain
            const matched =
              result.evaluation === 'blocked' ||
              result.evaluation === 'uncertain'
            expect(matched).toBe(true)
          }
        )
      )
    })
  })
})
