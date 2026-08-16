import { RuleEvaluator } from '../../../src/rules/RuleEvaluator'
import { ToolCall } from '../../../src/types/ToolCall'
import { BlockRule, AllowException } from '../../../src/types/RuleTypes'
import { TrustBoundaryConfig } from '../../../src/types/PluginConfig'

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolName: 'Bash',
    arguments: { command: 'rm -rf /tmp/test' },
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

describe('RuleEvaluator', () => {
  let evaluator: RuleEvaluator

  beforeEach(() => {
    evaluator = new RuleEvaluator()
  })

  describe('evaluate - allow exceptions have highest precedence', () => {
    it('should return allowed when exception matches even if block rule also matches', () => {
      const toolCall = createToolCall({
        arguments: { command: 'safe-cleanup --rm-rf' },
      })
      const blockRule = createBlockRule({
        id: 'BR-001',
        pattern: 'safe-cleanup',
      })
      const exception = createAllowException({
        id: 'AE-001',
        pattern: 'safe-cleanup',
      })

      const result = evaluator.evaluate(toolCall, [blockRule], [exception])

      expect(result.evaluation).toBe('allowed')
      expect(result.matchedException).toBe('AE-001')
    })
  })

  describe('evaluate - block rules', () => {
    it('should return blocked when a block rule matches with high confidence', () => {
      const toolCall = createToolCall({
        arguments: { command: 'rm -rf /important' },
      })
      const blockRule = createBlockRule({ pattern: 'rm -rf' })

      const result = evaluator.evaluate(toolCall, [blockRule], [])

      expect(result.evaluation).toBe('blocked')
      expect(result.matchedRule).toBe('BR-001')
    })

    it('should return blocked when multiple rules match (first match wins)', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /' } })
      const rule1 = createBlockRule({ id: 'BR-001', pattern: 'rm -rf' })
      const rule2 = createBlockRule({ id: 'BR-002', pattern: 'rm' })

      const result = evaluator.evaluate(toolCall, [rule1, rule2], [])

      expect(result.evaluation).toBe('blocked')
      expect(result.matchedRule).toBe('BR-001')
    })

    it('should skip disabled block rules', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /' } })
      const blockRule = createBlockRule({ pattern: 'rm -rf', enabled: false })

      const result = evaluator.evaluate(toolCall, [blockRule], [])

      expect(result.evaluation).toBe('uncertain')
    })
  })

  describe('evaluate - uncertain results', () => {
    it('should return uncertain when no rules match', () => {
      const toolCall = createToolCall({ arguments: { command: 'ls -la' } })
      const blockRule = createBlockRule({ pattern: 'rm -rf' })

      const result = evaluator.evaluate(toolCall, [blockRule], [])

      expect(result.evaluation).toBe('uncertain')
    })

    it('should return uncertain when all rules are disabled', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /' } })
      const blockRule = createBlockRule({ pattern: 'rm -rf', enabled: false })

      const result = evaluator.evaluate(toolCall, [blockRule], [])

      expect(result.evaluation).toBe('uncertain')
      expect(result.reasoning).toBe('No block rules matched')
    })

    it('should return uncertain with empty rules list', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /' } })

      const result = evaluator.evaluate(toolCall, [], [])

      expect(result.evaluation).toBe('uncertain')
    })
  })

  describe('evaluate - empty inputs', () => {
    it('should handle empty tool name', () => {
      const toolCall = createToolCall({ toolName: '' })
      const blockRule = createBlockRule({ pattern: 'rm -rf' })

      const result = evaluator.evaluate(toolCall, [blockRule], [])

      expect(result.evaluation).toBe('uncertain')
    })
  })

  describe('evaluateTrustBoundaries - protected paths', () => {
    const trustBoundary: TrustBoundaryConfig = {
      protectedPaths: ['/etc/', '~/.ssh/', '~/.env', '/etc/hosts'],
      protectedCommands: ['sudo', 'su', 'chmod 777', 'iptables'],
    }

    it('should block access to /etc/ path', () => {
      const toolCall = createToolCall({
        arguments: { command: 'cat /etc/passwd' },
      })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).not.toBeNull()
      expect(result!.evaluation).toBe('blocked')
      expect(result!.reasoning).toContain('/etc/')
    })

    it('should block access to ~/.ssh/ path', () => {
      const toolCall = createToolCall({ arguments: { command: 'ls ~/.ssh/' } })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).not.toBeNull()
      expect(result!.evaluation).toBe('blocked')
      expect(result!.reasoning).toContain('.ssh/')
    })

    it('should block access to ~/.env path', () => {
      const toolCall = createToolCall({ arguments: { command: 'cat ~/.env' } })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).not.toBeNull()
      expect(result!.evaluation).toBe('blocked')
      expect(result!.reasoning).toContain('.env')
    })

    it('should block access to /etc/hosts', () => {
      const toolCall = createToolCall({
        arguments: { command: 'cat /etc/hosts' },
      })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).not.toBeNull()
      expect(result!.evaluation).toBe('blocked')
      expect(result!.reasoning).toContain('/etc/')
    })

    it('should not flag normal commands', () => {
      const toolCall = createToolCall({ arguments: { command: 'ls -la /tmp' } })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).toBeNull()
    })
  })

  describe('evaluateTrustBoundaries - protected commands', () => {
    const trustBoundary: TrustBoundaryConfig = {
      protectedPaths: ['/etc/'],
      protectedCommands: [
        'sudo',
        'su',
        'chmod 777',
        'iptables',
        'modprobe',
        'insmod',
      ],
    }

    it('should block sudo command', () => {
      const toolCall = createToolCall({
        arguments: { command: 'sudo apt update' },
      })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).not.toBeNull()
      expect(result!.evaluation).toBe('blocked')
      expect(result!.reasoning).toContain('sudo')
    })

    it('should block su command', () => {
      const toolCall = createToolCall({ arguments: { command: 'su root' } })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).not.toBeNull()
      expect(result!.evaluation).toBe('blocked')
      expect(result!.reasoning).toContain('su')
    })

    it('should block chmod 777 command', () => {
      const toolCall = createToolCall({
        arguments: { command: 'chmod 777 /tmp/test' },
      })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).not.toBeNull()
      expect(result!.evaluation).toBe('blocked')
      expect(result!.reasoning).toContain('chmod 777')
    })

    it('should block iptables command', () => {
      const toolCall = createToolCall({ arguments: { command: 'iptables -L' } })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).not.toBeNull()
      expect(result!.evaluation).toBe('blocked')
      expect(result!.reasoning).toContain('iptables')
    })

    it('should block modprobe command', () => {
      const toolCall = createToolCall({
        arguments: { command: 'modprobe nf_conntrack' },
      })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).not.toBeNull()
      expect(result!.evaluation).toBe('blocked')
    })

    it('should block insmod command', () => {
      const toolCall = createToolCall({
        arguments: { command: 'insmod /tmp/module.ko' },
      })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).not.toBeNull()
      expect(result!.evaluation).toBe('blocked')
    })

    it('should not flag normal commands that contain protected command names as substrings', () => {
      const toolCall = createToolCall({
        arguments: { command: 'make sudo-test' },
      })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).toBeNull()
    })
  })

  describe('evaluateTrustBoundaries - no config', () => {
    it('should return null when no trust boundary config', () => {
      const toolCall = createToolCall({
        arguments: { command: 'cat /etc/passwd' },
      })
      const result = evaluator.evaluateTrustBoundaries(toolCall, undefined)

      expect(result).toBeNull()
    })

    it('should return null for empty trust boundary config', () => {
      const trustBoundary: TrustBoundaryConfig = {
        protectedPaths: [],
        protectedCommands: [],
      }
      const toolCall = createToolCall({
        arguments: { command: 'cat /etc/passwd' },
      })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).toBeNull()
    })
  })

  describe('evaluate - trust boundary takes precedence', () => {
    it('should block trust boundary violation even if allow exception matches', () => {
      const trustBoundary: TrustBoundaryConfig = {
        protectedPaths: ['/etc/'],
        protectedCommands: ['sudo'],
      }
      const toolCall = createToolCall({
        arguments: { command: 'cat /etc/passwd' },
      })
      const blockRule = createBlockRule({ pattern: 'passwd' })
      const exception = createAllowException({ pattern: 'passwd' })

      const result = evaluator.evaluate(
        toolCall,
        [blockRule],
        [exception],
        trustBoundary
      )

      expect(result.evaluation).toBe('blocked')
      expect(result.matchedRule).toContain('TB-PATH')
    })

    it('should block both trust boundary and block rule violations', () => {
      const trustBoundary: TrustBoundaryConfig = {
        protectedPaths: ['/etc/'],
        protectedCommands: [],
      }
      const toolCall = createToolCall({
        arguments: { command: 'rm -rf /etc/' },
      })
      const blockRule = createBlockRule({ pattern: 'rm -rf' })

      const result = evaluator.evaluate(
        toolCall,
        [blockRule],
        [],
        trustBoundary
      )

      expect(result.evaluation).toBe('blocked')
      expect(result.matchedRule).toContain('TB-PATH')
    })
  })

  describe('evaluate - non-Bash tools', () => {
    it('should not trigger trust boundary for non-Bash tools', () => {
      const trustBoundary: TrustBoundaryConfig = {
        protectedPaths: ['/etc/'],
        protectedCommands: [],
      }
      const toolCall = createToolCall({
        toolName: 'Read',
        arguments: { path: '/etc/passwd' },
      })
      const result = evaluator.evaluateTrustBoundaries(toolCall, trustBoundary)

      expect(result).toBeNull()
    })
  })

  describe('evaluateWithLLMFallback', () => {
    it('should return pattern result when pattern match is decisive', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /' } })
      const blockRule = createBlockRule({ pattern: 'rm -rf' })

      const result = evaluator.evaluateWithLLMFallback(
        toolCall,
        [blockRule],
        []
      )

      expect(result.evaluation).toBe('blocked')
      expect(result.matchedRule).toBe('BR-001')
    })

    it('should block uncertain results with semantic fallback', () => {
      const toolCall = createToolCall({ arguments: { command: 'ls -la' } })
      const blockRule = createBlockRule({ pattern: 'rm -rf' })

      const result = evaluator.evaluateWithLLMFallback(
        toolCall,
        [blockRule],
        []
      )

      expect(result.evaluation).toBe('blocked')
      expect(result.matchedRule).toBe('semantic-fallback')
      expect(result.reasoning).toContain('LLM semantic evaluation')
    })

    it('should use exception even in evaluateWithLLMFallback', () => {
      const toolCall = createToolCall({
        arguments: { command: 'safe-cleanup' },
      })
      const blockRule = createBlockRule({ pattern: 'safe' })
      const exception = createAllowException({ pattern: 'safe-cleanup' })

      const result = evaluator.evaluateWithLLMFallback(
        toolCall,
        [blockRule],
        [exception]
      )

      expect(result.evaluation).toBe('allowed')
      expect(result.matchedException).toBe('AE-001')
    })

    it('should return semantic-fallback blocked for empty rules', () => {
      const toolCall = createToolCall({ arguments: { command: 'anything' } })

      const result = evaluator.evaluateWithLLMFallback(toolCall, [], [])

      expect(result.evaluation).toBe('blocked')
      expect(result.matchedRule).toBe('semantic-fallback')
    })
  })

  describe('Property Based Tests', () => {
    it('should never block when all rules are disabled regardless of pattern', () => {
      const patterns = ['rm -rf', 'dangerous', 'delete', 'overwrite', 'format']
      const commands = [
        'rm -rf /',
        'rm -rf /tmp',
        'echo hello',
        'ls -la',
        'cat /etc/passwd',
      ]

      for (const pattern of patterns) {
        for (const cmd of commands) {
          const toolCall = createToolCall({ arguments: { command: cmd } })
          const rule = createBlockRule({ pattern, enabled: false })

          const result = evaluator.evaluate(toolCall, [rule], [])

          expect(result.evaluation).not.toBe('blocked')
        }
      }
    })

    it('should always return uncertain when rules list is empty', () => {
      const commands = ['rm -rf /', 'anything', 'echo hello']

      for (const cmd of commands) {
        const toolCall = createToolCall({ arguments: { command: cmd } })

        const result = evaluator.evaluate(toolCall, [], [])

        expect(result.evaluation).toBe('uncertain')
      }
    })

    it('should always return uncertain when exceptions list is empty and no block rules match', () => {
      const toolCall = createToolCall({
        arguments: { command: 'safe-command' },
      })
      const rule = createBlockRule({ pattern: 'different-pattern' })

      const result = evaluator.evaluate(toolCall, [rule], [])

      expect(result.evaluation).toBe('uncertain')
    })
  })
})
