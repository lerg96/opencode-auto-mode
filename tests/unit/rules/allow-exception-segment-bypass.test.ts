import { RuleEvaluator } from '../../../src/rules/RuleEvaluator'
import { ToolCall } from '../../../src/types/ToolCall'
import { BlockRule, AllowException } from '../../../src/types/RuleTypes'

function createToolCall(command: string): ToolCall {
  return {
    toolName: 'Bash' as const,
    arguments: { command },
    context: {
      agentName: 'test',
      workingDirectory: '/tmp',
      sessionId: 'test-session',
    },
  }
}

function createBlockRule(overrides: Partial<BlockRule> = {}): BlockRule {
  return {
    id: 'test-rule',
    type: 'pattern',
    pattern: '',
    category: 'test',
    description: 'test',
    severity: 'high',
    enabled: true,
    ...overrides,
  }
}

function createAllowException(overrides: Partial<AllowException> = {}): AllowException {
  return {
    id: 'test-exception',
    type: 'pattern',
    pattern: '',
    enabled: true,
    description: 'test',
    ...overrides,
  }
}

describe('Allow-exception: segment bypass in compound commands', () => {
  const evaluator = new RuleEvaluator()

  it('allows compound command when ALL segments match allow-exception', () => {
    const exception = createAllowException({
      id: 'chmod-permitted',
      pattern: 'chmod 644',
      description: 'Allow chmod 644',
    })

    // Both segments are chmod 644 — should allow
    const toolCall = createToolCall('chmod 644 file && chmod 644 other')
    const result = evaluator.evaluate(toolCall, [], [exception], {
      protectedPaths: [],
      protectedCommands: [],
    })
    expect(result.evaluation).toBe('allowed')
  })

  it('does NOT allow compound command when only SOME segments match', () => {
    const exception = createAllowException({
      id: 'chmod-permitted',
      pattern: 'chmod 644',
      description: 'Allow chmod 644',
    })

    // First segment matches, but `other 777` does not — should NOT allow
    const toolCall = createToolCall('chmod 644 file && chmod 777 other')
    const result = evaluator.evaluate(toolCall, [], [exception], {
      protectedPaths: [],
      protectedCommands: [],
    })
    expect(result.evaluation).not.toBe('allowed')
  })

  it('does NOT allow when a block rule overrides in compound command', () => {
    const blockRule = createBlockRule({
      id: 'deny-777',
      pattern: 'regex:chmod\\s+777',
      severity: 'high',
    })

    const exception = createAllowException({
      id: 'chmod-permitted',
      pattern: 'chmod 644',
      description: 'Allow chmod 644',
    })

    // chmod 644 exception checks per-segment; chmod 777 hits block rule
    const toolCall = createToolCall('chmod 644 file && chmod 777 other')
    const result = evaluator.evaluate(toolCall, [blockRule], [exception], {
      protectedPaths: [],
      protectedCommands: [],
    })
    expect(result.evaluation).toBe('blocked')
  })

  it('does NOT allow if block rule matches any segment', () => {
    const blockRule = createBlockRule({
      id: 'deny-rf',
      pattern: 'regex:rm\\s+-rf\\s+',
      severity: 'critical',
    })

    const exception = createAllowException({
      id: 'ls-permitted',
      pattern: 'ls -la',
      description: 'Allow ls',
    })

    // rm -rf matches block despite ls -la exception
    const toolCall = createToolCall('ls -la && rm -rf .')
    const result = evaluator.evaluate(toolCall, [blockRule], [exception], {
      protectedPaths: [],
      protectedCommands: [],
    })
    expect(result.evaluation).toBe('blocked')
  })
})

describe('Block rule: substring matching false positives', () => {
  const evaluator = new RuleEvaluator()

  it('BR-001 matches substring "rm -rf " in longer commands (by design)', () => {
    const blockRule = createBlockRule({
      id: 'BR-001',
      pattern: 'rm -rf ',
      severity: 'critical',
    })

    // 'rm -rf node_modules_' contains the literal substring 'rm -rf ' — matches!
    const toolCall = createToolCall('rm -rf node_modules_')
    const result = evaluator.evaluate(toolCall, [blockRule], [], {
      protectedPaths: [],
      protectedCommands: [],
    })
    expect(result.evaluation).toBe('blocked')
  })

  it('BR-001 matches rm -rf with partial paths', () => {
    const blockRule = createBlockRule({
      id: 'BR-001',
      pattern: 'rm -rf ',
      severity: 'critical',
    })

    // Multiple variations — all match because pattern is substring
    expect(
      evaluator.evaluate(createToolCall('rm -rf /tmp/test'), [blockRule], [], {
        protectedPaths: [],
        protectedCommands: [],
      }).evaluation
    ).toBe('blocked')
    expect(
      evaluator.evaluate(
        createToolCall('rm -rf ./relative/path'),
        [blockRule],
        [],
        { protectedPaths: [], protectedCommands: [] }
      ).evaluation
    ).toBe('blocked')
  })
})
