import { RuleEvaluator } from '../../src/rules/RuleEvaluator';
import { PatternMatcher } from '../../src/rules/PatternMatcher';
import { ToolCall } from '../../src/types/ToolCall';
import { BlockRule, AllowException } from '../../src/types/RuleTypes';
import { TrustBoundaryConfig } from '../../src/types/PluginConfig';

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolName: 'Bash',
    arguments: { command: 'ls -la' },
    context: { agentName: 'general', workingDirectory: '/tmp', sessionId: 'test' },
    ...overrides,
  };
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
  };
}

function createAllowException(overrides: Partial<AllowException> = {}): AllowException {
  return {
    id: 'AE-001',
    type: 'pattern',
    pattern: 'safe-cleanup',
    description: 'Allow safe cleanup',
    enabled: true,
    ...overrides,
  };
}

describe('RuleEvaluator - Property-Based Tests', () => {
  let evaluator: RuleEvaluator;

  beforeEach(() => {
    evaluator = new RuleEvaluator(new PatternMatcher());
  });

  it('commutativity: evaluating with rules in any order produces the same result', () => {
    for (let i = 0; i < 20; i++) {
      const patterns = [
        'rm -rf',
        'chmod 777',
        'sudo apt',
        'docker rm',
        'git push --force',
        'kubectl delete',
        'DROP TABLE',
        'insmod',
        'modprobe',
        'systemctl restart',
      ];
      const commands = [
        'rm -rf /tmp/test',
        'chmod 777 /tmp/file',
        'sudo apt update',
        'docker rm -f container',
        'git push --force origin',
        'kubectl delete pod test',
        'DROP TABLE users',
        'insmod /tmp/mod.ko',
        'modprobe nf_conntrack',
        'systemctl restart nginx',
        'ls -la /tmp',
        'echo hello world',
        'cat /etc/passwd',
        'safe-command',
        'safe-cleanup',
      ];

      const numRules = 2 + (i % 8);
      const rules: BlockRule[] = [];
      for (let j = 0; j < numRules; j++) {
        rules.push(createBlockRule({ id: `BR-${String(100 + j).padStart(3, '0')}`, pattern: patterns[j % patterns.length] }));
      }

      for (const cmd of commands) {
        const toolCall = createToolCall({ arguments: { command: cmd } });

        // Evaluate with original order
        const resultForward = evaluator.evaluate(toolCall, rules, []);

        // Evaluate with reversed order
        const rulesReversed = [...rules].reverse();
        const resultReversed = evaluator.evaluate(toolCall, rulesReversed, []);

        // The evaluation result must be the same regardless of order
        expect(resultForward.evaluation).toBe(resultReversed.evaluation);
      }
    }
  });

  it('idempotency: evaluating the same tool call multiple times produces the same result', () => {
    const patterns = ['rm -rf', 'sudo apt', 'chmod 777', 'docker rm -f', 'git push --force'];
    const commands = [
      'rm -rf /tmp/test',
      'sudo apt update',
      'chmod 777 /tmp/file',
      'docker rm -f container',
      'git push --force origin',
      'ls -la /tmp',
      'safe-command',
    ];

    for (const cmd of commands) {
      for (const pattern of patterns) {
        const rules = [createBlockRule({ pattern })];

        const toolCall = createToolCall({ arguments: { command: cmd } });
        const results: string[] = [];

        for (let i = 0; i < 50; i++) {
          results.push(evaluator.evaluate(toolCall, rules, []).evaluation);
        }

        const uniqueResults = new Set(results);
        expect(uniqueResults.size).toBe(1);
      }
    }
  });

  it('allow exception always overrides matching block rule', () => {
    const patterns = ['rm -rf', 'chmod 777', 'sudo apt', 'docker rm', 'git push --force'];
    const commands = [
      'rm -rf /tmp/test --safe',
      'chmod 777 /tmp/file --safe',
      'sudo apt update --safe',
      'docker rm -f container --safe',
      'git push --force origin --safe',
    ];

    for (let i = 0; i < patterns.length; i++) {
      const blockRule = createBlockRule({ pattern: patterns[i] });
      const exception = createAllowException({ pattern: commands[i].split(' ')[0] });

      for (let j = 0; j < 20; j++) {
        const suffix = j === 0 ? '' : `-${j}`;
        const toolCall = createToolCall({ arguments: { command: `${commands[i]}${suffix}` } });
        const result = evaluator.evaluate(toolCall, [blockRule], [exception]);

        expect(result.evaluation).toBe('allowed');
        expect(result.matchedException).toBe(exception.id);
      }
    }
  });

  it('disabled rules never produce blocked result regardless of tool call', () => {
    const disabledPatterns = ['rm -rf', 'sudo apt', 'chmod 777', 'docker rm', 'git push --force'];
    const commands = [
      'rm -rf /',
      'sudo apt update',
      'chmod 777 /tmp/file',
      'docker rm -f container',
      'git push --force origin',
      'kubectl delete pod',
      'DROP TABLE users',
      'insmod /tmp/mod.ko',
    ];

    for (const pattern of disabledPatterns) {
      const rule = createBlockRule({ pattern, enabled: false });

      for (const cmd of commands) {
        const toolCall = createToolCall({ arguments: { command: cmd } });
        const result = evaluator.evaluate(toolCall, [rule], []);

        expect(result.evaluation).not.toBe('blocked');
      }
    }
  });

  it('empty rules list always produces uncertain result', () => {
    const commands = ['rm -rf /', 'sudo apt update', 'ls -la', 'echo hello', 'safe-command'];

    for (const cmd of commands) {
      const toolCall = createToolCall({ arguments: { command: cmd } });
      const result = evaluator.evaluate(toolCall, [], []);

      expect(result.evaluation).toBe('uncertain');
    }
  });

  it('trust boundary blocks even when allow exception matches', () => {
    const trustBoundary: TrustBoundaryConfig = {
      protectedPaths: ['/etc/', '~/.ssh/', '~/.env'],
      protectedCommands: ['sudo', 'su', 'chmod 777'],
    };

    const commands = [
      'cat /etc/passwd',
      'ls ~/.ssh/',
      'cat ~/.env',
      'sudo apt update',
      'su root',
      'chmod 777 /tmp/file',
    ];

    for (const cmd of commands) {
      const toolCall = createToolCall({ arguments: { command: cmd } });
      const blockRule = createBlockRule({ pattern: 'safe' });
      const exception = createAllowException({ pattern: cmd.split(' ')[0] });

      const result = evaluator.evaluate(toolCall, [blockRule], [exception], trustBoundary);

      expect(result.evaluation).toBe('blocked');
    }
  });

  it('empty exception list never produces allowed result from exceptions', () => {
    const blockPatterns = ['rm -rf', 'sudo apt', 'chmod 777'];
    const commands = [
      'rm -rf /tmp/test',
      'sudo apt update',
      'chmod 777 /tmp/file',
      'ls -la /tmp',
    ];

    for (const pattern of blockPatterns) {
      const rule = createBlockRule({ pattern });

      for (const cmd of commands) {
        const toolCall = createToolCall({ arguments: { command: cmd } });
        const result = evaluator.evaluate(toolCall, [rule], []);

        if (result.evaluation === 'allowed') {
          fail('Expected no allowed result with empty exception list');
        }
      }
    }
  });
});
