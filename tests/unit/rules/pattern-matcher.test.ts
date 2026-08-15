import { PatternMatcher } from '../../../src/rules/PatternMatcher';
import { ToolCall } from '../../../src/types/ToolCall';
import { BlockRule, AllowException } from '../../../src/types/RuleTypes';

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

describe('PatternMatcher', () => {
  let matcher: PatternMatcher;

  beforeEach(() => {
    matcher = new PatternMatcher();
  });

  describe('match - substring patterns', () => {
    it('should match substring pattern in command', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /tmp/test' } });
      const rule = createBlockRule({ pattern: 'rm -rf' });
      const result = matcher.match(toolCall, rule);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe('high');
    });

    it('should match substring pattern in file path', () => {
      const toolCall = createToolCall({ toolName: 'Read', arguments: { path: '/tmp/test/file.txt' } });
      const rule = createBlockRule({ pattern: '/tmp/test' });
      const result = matcher.match(toolCall, rule);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe('high');
    });

    it('should not match when pattern is not found', () => {
      const toolCall = createToolCall({ arguments: { command: 'ls -la' } });
      const rule = createBlockRule({ pattern: 'rm -rf' });
      const result = matcher.match(toolCall, rule);

      expect(result.matched).toBe(false);
      expect(result.confidence).toBe('low');
    });
  });

  describe('match - regex patterns', () => {
    it('should match regex pattern in command', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /important' } });
      const rule = createBlockRule({ pattern: 'regex:rm\\s+-\\s*rf' });
      const result = matcher.match(toolCall, rule);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe('high');
    });

    it('should match regex pattern in file path', () => {
      const toolCall = createToolCall({ toolName: 'Write', arguments: { path: '/etc/passwd' } });
      const rule = createBlockRule({ pattern: 'regex:/etc/\\w+' });
      const result = matcher.match(toolCall, rule);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe('high');
    });

    it('should not match when regex does not match', () => {
      const toolCall = createToolCall({ arguments: { command: 'echo hello' } });
      const rule = createBlockRule({ pattern: 'regex:rm\\s+-\\s*rf' });
      const result = matcher.match(toolCall, rule);

      expect(result.matched).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should return low confidence for invalid regex', () => {
      const toolCall = createToolCall({ arguments: { command: 'echo test' } });
      const rule = createBlockRule({ pattern: 'regex:[invalid' });
      const result = matcher.match(toolCall, rule);

      expect(result.matched).toBe(false);
      expect(result.confidence).toBe('low');
    });
  });

  describe('match - disabled rules', () => {
    it('should not match disabled rules', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /' } });
      const rule = createBlockRule({ pattern: 'rm -rf', enabled: false });
      const result = matcher.match(toolCall, rule);

      expect(result.matched).toBe(false);
      expect(result.confidence).toBe('low');
    });
  });

  describe('match - non-Bash tools', () => {
    it('should return low for non-Bash tool with command pattern', () => {
      const toolCall = createToolCall({ toolName: 'Read', arguments: { path: '/test' } });
      const rule = createBlockRule({ pattern: 'rm -rf' });
      const result = matcher.match(toolCall, rule);

      expect(result.matched).toBe(false);
      expect(result.confidence).toBe('low');
    });
  });

  describe('matchException', () => {
    it('should match allow exception substring', () => {
      const toolCall = createToolCall({ arguments: { command: 'safe-cleanup --all' } });
      const exception = createAllowException({ pattern: 'safe-cleanup' });
      const result = matcher.matchException(toolCall, exception);

      expect(result).toBe(true);
    });

    it('should match allow exception regex', () => {
      const toolCall = createToolCall({ arguments: { command: 'safe-cleanup-prod --force' } });
      const exception = createAllowException({ pattern: 'regex:safe-cleanup' });
      const result = matcher.matchException(toolCall, exception);

      expect(result).toBe(true);
    });

    it('should not match when exception pattern does not match', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /' } });
      const exception = createAllowException({ pattern: 'safe-cleanup' });
      const result = matcher.matchException(toolCall, exception);

      expect(result).toBe(false);
    });

    it('should not match disabled exception', () => {
      const toolCall = createToolCall({ arguments: { command: 'safe-cleanup --all' } });
      const exception = createAllowException({ pattern: 'safe-cleanup', enabled: false });
      const result = matcher.matchException(toolCall, exception);

      expect(result).toBe(false);
    });

    it('should match exception in file path', () => {
      const toolCall = createToolCall({ toolName: 'Read', arguments: { path: '/var/log/safe-cleanup.log' } });
      const exception = createAllowException({ pattern: 'safe-cleanup' });
      const result = matcher.matchException(toolCall, exception);

      expect(result).toBe(true);
    });
  });

  describe('matchCommandStructure', () => {
    it('should match command name without flags', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /tmp' } });
      const result = matcher.matchCommandStructure(toolCall, 'rm');

      expect(result).toBe(true);
    });

    it('should match command name with flags', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /tmp' } });
      const result = matcher.matchCommandStructure(toolCall, 'rm', ['-rf', '-r']);

      expect(result).toBe(true);
    });

    it('should not match different command name', () => {
      const toolCall = createToolCall({ arguments: { command: 'ls -la' } });
      const result = matcher.matchCommandStructure(toolCall, 'rm');

      expect(result).toBe(false);
    });

    it('should return false when no command extracted', () => {
      const toolCall = createToolCall({ toolName: 'Read', arguments: { path: '/test' } });
      const result = matcher.matchCommandStructure(toolCall, 'rm');

      expect(result).toBe(false);
    });

    it('should return true when no flags specified', () => {
      const toolCall = createToolCall({ arguments: { command: 'echo hello world' } });
      const result = matcher.matchCommandStructure(toolCall, 'echo');

      expect(result).toBe(true);
    });
  });
});

describe('PatternMatcher - Property Based Tests', () => {
  let matcher: PatternMatcher;

  beforeEach(() => {
    matcher = new PatternMatcher();
  });

  it('should never match a disabled rule regardless of pattern and tool call content', () => {
    for (let i = 0; i < 20; i++) {
      const patterns = ['rm -rf', 'regex:[a-z]+', 'echo', 'cat ', 'dd if='];
      const commands = ['rm -rf /', 'echo hello', 'cat /etc/passwd', 'dd if=/dev/zero', 'ls -la'];
      const toolNames = ['Bash', 'Read', 'Write'];

      for (const pattern of patterns) {
        for (const cmd of commands) {
          for (const toolName of toolNames) {
            const toolCall = createToolCall({
              toolName: toolName as any,
              arguments: toolName === 'Bash' ? { command: cmd } : { path: cmd },
            });
            const rule = createBlockRule({ pattern, enabled: false });
            const result = matcher.match(toolCall, rule);

            expect(result.matched).toBe(false);
            expect(result.confidence).toBe('low');
          }
        }
      }
    }
  });

  it('should match substring patterns case-sensitively (exact match required)', () => {
    const toolCall = createToolCall({ arguments: { command: 'RM -RF /tmp' } });
    const rule = createBlockRule({ pattern: 'rm -rf' });
    const result = matcher.match(toolCall, rule);

    expect(result.matched).toBe(false);
  });

  it('should return high confidence for all valid regex matches', () => {
    const testCases = [
      { cmd: 'rm -rf /tmp', pattern: 'regex:rm\\s+-\\s*rf' },
      { cmd: 'rm -rf /tmp', pattern: 'regex:rm' },
      { cmd: 'cat /etc/passwd', pattern: 'regex:/etc/' },
      { cmd: 'echo hello', pattern: 'regex:hello' },
    ];

    for (const { cmd, pattern } of testCases) {
      const toolCall = createToolCall({ arguments: { command: cmd } });
      const rule = createBlockRule({ pattern });
      const result = matcher.match(toolCall, rule);

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe('high');
    }
  });

  it('should handle empty command gracefully', () => {
    const toolCall = createToolCall({ arguments: { command: '' } });
    const rule = createBlockRule({ pattern: 'rm -rf' });
    const result = matcher.match(toolCall, rule);

    expect(result.matched).toBe(false);
    expect(result.confidence).toBe('low');
  });

  it('should handle empty file path gracefully', () => {
    const toolCall = createToolCall({ toolName: 'Read', arguments: { path: '' } });
    const rule = createBlockRule({ pattern: '/etc/' });
    const result = matcher.match(toolCall, rule);

    expect(result.matched).toBe(false);
    expect(result.confidence).toBe('low');
  });
});
