import { PatternMatcher } from '../../src/rules/PatternMatcher';
import { ToolCall } from '../../src/types/ToolCall';
import { BlockRule, AllowException } from '../../src/types/RuleTypes';

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

describe('PatternMatcher - Property-Based Tests', () => {
  let matcher: PatternMatcher;

  beforeEach(() => {
    matcher = new PatternMatcher();
  });

  it('regex matching is consistent across multiple calls (deterministic)', () => {
    const testCases = [
      { cmd: 'rm -rf /tmp/test', pattern: 'regex:rm\\s+-\\s*rf' },
      { cmd: 'cat /etc/passwd', pattern: 'regex:/etc/' },
      { cmd: 'echo hello world', pattern: 'regex:hello' },
      { cmd: 'sudo apt update', pattern: 'regex:sudo\\s+' },
      { cmd: 'chmod 777 /tmp/file', pattern: 'regex:chmod\\s+777' },
      { cmd: 'docker rm -f container', pattern: 'regex:docker\\s+rm\\s+-f' },
      { cmd: 'git push --force', pattern: 'regex:git\\s+push\\s+--force' },
      { cmd: 'ls -la /tmp', pattern: 'regex:ls\\s+' },
      { cmd: 'safe-command --arg', pattern: 'regex:safe-' },
      { cmd: 'DROP TABLE users', pattern: 'regex:DROP\\s+TABLE' },
    ];

    for (const { cmd, pattern } of testCases) {
      const toolCall = createToolCall({ arguments: { command: cmd } });
      const rule = createBlockRule({ pattern });

      const results: boolean[] = [];
      for (let i = 0; i < 30; i++) {
        const result = matcher.match(toolCall, rule);
        results.push(result.matched);
      }

      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(1);
    }
  });

  it('substring matching is consistent across multiple calls (deterministic)', () => {
    const testCases = [
      { cmd: 'rm -rf /tmp/test', pattern: 'rm -rf' },
      { cmd: 'cat /etc/passwd', pattern: '/etc/' },
      { cmd: 'echo hello world', pattern: 'hello' },
      { cmd: 'sudo apt update', pattern: 'sudo ' },
      { cmd: 'chmod 777 /tmp/file', pattern: '777' },
      { cmd: 'docker rm -f container', pattern: 'docker rm' },
      { cmd: 'safe-command --arg', pattern: 'safe-' },
    ];

    for (const { cmd, pattern } of testCases) {
      const toolCall = createToolCall({ arguments: { command: cmd } });
      const rule = createBlockRule({ pattern });

      const results: boolean[] = [];
      for (let i = 0; i < 30; i++) {
        const result = matcher.match(toolCall, rule);
        results.push(result.matched);
      }

      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(1);
    }
  });

  it('regex matching on file path is consistent', () => {
    const testCases = [
      { filePath: '/etc/passwd', pattern: 'regex:/etc/' },
      { filePath: '/home/user/.ssh/id_rsa', pattern: 'regex:/ssh/' },
      { filePath: '/tmp/test.txt', pattern: 'regex:/tmp/' },
    ];

    for (const { filePath, pattern } of testCases) {
      const toolCall = createToolCall({ toolName: 'Read', arguments: { path: filePath } });
      const rule = createBlockRule({ pattern });

      const results: boolean[] = [];
      for (let i = 0; i < 30; i++) {
        const result = matcher.match(toolCall, rule);
        results.push(result.matched);
      }

      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(1);
    }
  });

  it('substring matching on file path is consistent', () => {
    const testCases = [
      { filePath: '/etc/passwd', pattern: '/etc/' },
      { filePath: '/home/user/.ssh/id_rsa', pattern: '.ssh/' },
      { filePath: '/tmp/test.txt', pattern: 'test' },
    ];

    for (const { filePath, pattern } of testCases) {
      const toolCall = createToolCall({ toolName: 'Read', arguments: { path: filePath } });
      const rule = createBlockRule({ pattern });

      const results: boolean[] = [];
      for (let i = 0; i < 30; i++) {
        const result = matcher.match(toolCall, rule);
        results.push(result.matched);
      }

      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(1);
    }
  });

  it('exception matching is consistent across multiple calls', () => {
    const testCases = [
      { cmd: 'safe-cleanup --all', pattern: 'safe-cleanup' },
      { cmd: 'safe-cleanup-prod --force', pattern: 'regex:safe-cleanup' },
      { cmd: 'safe-operation --arg', pattern: 'safe-operation' },
      { cmd: 'safe-command --arg', pattern: 'regex:safe-' },
    ];

    for (const { cmd, pattern } of testCases) {
      const toolCall = createToolCall({ arguments: { command: cmd } });
      const exception = createAllowException({ pattern });

      const results: boolean[] = [];
      for (let i = 0; i < 30; i++) {
        const result = matcher.matchException(toolCall, exception);
        results.push(result);
      }

      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(1);
    }
  });

  it('substring matching correctness: contains check always works for matching strings', () => {
    const patternsAndCommands: [string, string][] = [
      ['rm -rf', 'rm -rf /tmp/test'],
      ['sudo', 'sudo apt update'],
      ['chmod 777', 'chmod 777 /tmp/file'],
      ['docker', 'docker ps -a'],
      ['git push --force', 'git push --force origin main'],
      ['/etc/', 'cat /etc/passwd'],
      ['~/.ssh/', 'ls ~/.ssh/'],
      ['DROP TABLE', 'DROP TABLE users'],
      ['insmod', 'insmod /tmp/mod.ko'],
      ['modprobe', 'modprobe nf_conntrack'],
      ['systemctl restart', 'systemctl restart nginx'],
      ['kubectl delete', 'kubectl delete pod test'],
      ['crontab -e', 'crontab -e'],
    ];

    for (const [pattern, cmd] of patternsAndCommands) {
      const toolCall = createToolCall({ arguments: { command: cmd } });
      const rule = createBlockRule({ pattern });
      const result = matcher.match(toolCall, rule);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe('high');
    }
  });
});
