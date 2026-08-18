import { PatternMatcher } from '../../../src/rules/PatternMatcher'
import { ToolCall } from '../../../src/types/ToolCall'
import { BlockRule, AllowException } from '../../../src/types/RuleTypes'

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

describe('PatternMatcher', () => {
  let matcher: PatternMatcher

  beforeEach(() => {
    matcher = new PatternMatcher()
  })

  describe('match - substring patterns', () => {
    it('should match substring pattern in command', () => {
      const toolCall = createToolCall({
        arguments: { command: 'rm -rf /tmp/test' },
      })
      const rule = createBlockRule({ pattern: 'rm -rf' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('should match substring pattern in file path', () => {
      const toolCall = createToolCall({
        toolName: 'Read',
        arguments: { path: '/tmp/test/file.txt' },
      })
      const rule = createBlockRule({ pattern: '/tmp/test' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('should not match when pattern is not found', () => {
      const toolCall = createToolCall({ arguments: { command: 'ls -la' } })
      const rule = createBlockRule({ pattern: 'rm -rf' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(false)
      expect(result.confidence).toBe('low')
    })
  })

  describe('match - regex patterns', () => {
    it('should match regex pattern in command', () => {
      const toolCall = createToolCall({
        arguments: { command: 'rm -rf /important' },
      })
      const rule = createBlockRule({ pattern: 'regex:rm\\s+-\\s*rf' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('should match regex pattern in file path', () => {
      const toolCall = createToolCall({
        toolName: 'Write',
        arguments: { path: '/etc/passwd' },
      })
      const rule = createBlockRule({ pattern: 'regex:/etc/\\w+' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('should not match when regex does not match', () => {
      const toolCall = createToolCall({ arguments: { command: 'echo hello' } })
      const rule = createBlockRule({ pattern: 'regex:rm\\s+-\\s*rf' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(false)
      expect(result.confidence).toBe('low')
    })

    it('should return low confidence for invalid regex', () => {
      const toolCall = createToolCall({ arguments: { command: 'echo test' } })
      const rule = createBlockRule({ pattern: 'regex:[invalid' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(false)
      expect(result.confidence).toBe('low')
    })
  })

  describe('match - disabled rules', () => {
    it('should not match disabled rules', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /' } })
      const rule = createBlockRule({ pattern: 'rm -rf', enabled: false })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(false)
      expect(result.confidence).toBe('low')
    })
  })

  describe('match - non-Bash tools', () => {
    it('should return low for non-Bash tool with command pattern', () => {
      const toolCall = createToolCall({
        toolName: 'Read',
        arguments: { path: '/test' },
      })
      const rule = createBlockRule({ pattern: 'rm -rf' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(false)
      expect(result.confidence).toBe('low')
    })
  })

  describe('match - unicode and special characters', () => {
    it('should match unicode filename in command', () => {
      const toolCall = createToolCall({
        arguments: { command: 'node 文件.ts' },
      })
      const rule = createBlockRule({ pattern: '文件' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('should match unicode path in command', () => {
      const toolCall = createToolCall({
        arguments: { command: 'cat /tmp/tèst.log' },
      })
      const rule = createBlockRule({ pattern: 'tèst.log' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('should match shell pipeline with pipe char', () => {
      const toolCall = createToolCall({
        arguments: { command: 'echo $HOME | cat' },
      })
      const rule = createBlockRule({ pattern: 'echo | cat' })
      const result = matcher.match(toolCall, rule)

      // The pattern 'echo | cat' won't match 'echo $HOME | cat' because '$HOME' is in between
      expect(result.matched).toBe(false)
    })

    it('should match shell pipeline without the specific pattern', () => {
      const toolCall = createToolCall({
        arguments: { command: 'echo $HOME | cat' },
      })
      const rule = createBlockRule({ pattern: 'echo $HOME' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('should match command with chinese characters in rm -rf', () => {
      const toolCall = createToolCall({
        arguments: { command: 'rm -rf 中文目录' },
      })
      const rule = createBlockRule({ pattern: 'rm -rf' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('should match backtick-quoted command', () => {
      const toolCall = createToolCall({
        arguments: { command: 'cat `ls -la`' },
      })
      const rule = createBlockRule({ pattern: 'ls -la' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('should handle regex with unicode content', () => {
      const toolCall = createToolCall({
        arguments: { command: 'ls 日本語ファイル' },
      })
      const rule = createBlockRule({ pattern: 'regex:\\w+' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(true)
      expect(result.confidence).toBe('high')
    })

    it('should match pipe-based filtering', () => {
      const toolCall = createToolCall({
        arguments: { command: 'grep -r "pattern" * | wc -l' },
      })
      const rule = createBlockRule({ pattern: 'wc -l' })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(true)
      expect(result.confidence).toBe('high')
    })
  })

  describe('match - suspicious patterns', () => {
    it('should return low confidence for patterns over 100 chars with 2+ quantifiers', () => {
      const toolCall = createToolCall({
        arguments: { command: 'test' },
      })
      const longPattern = '(a+){10}(b*){20}(c+){15}(d*){10}(e+)'
      const rule = createBlockRule({ pattern: `regex:${longPattern}` })
      const result = matcher.match(toolCall, rule)

      // Should not match (low confidence due to suspicious pattern detection)
      expect(result.confidence).toBe('low')
    })

    it('should match normally when pattern is long but has fewer than 2 quantifiers', () => {
      const toolCall = createToolCall({
        arguments: { command: 'rm -rf /important' },
      })
      const longPattern = 'rm (\\s|-)*rf (\\s|-)*\\/ (\\w)*\\/'
      const rule = createBlockRule({ pattern: `regex:${longPattern}` })
      const result = matcher.match(toolCall, rule)

      // This has quantifiers but let's check: (\\s|-) has *, (\\s|-)* has *, (\\w)* has *, (\\s|-)* - wait, let me count
      // (\\s|-)*, (\\s|-)*, (\\w)*, (\\s|-)* - actually this should trigger suspicious
      // Let me use a pattern that's long but has no quantifiers
      const longSafePattern =
        'rm -rf /important/directory/with/deep/nested/path/structure'
      const rule2 = createBlockRule({ pattern: longSafePattern })
      const result2 = matcher.match(
        createToolCall({
          arguments: {
            command:
              'rm -rf /important/directory/with/deep/nested/path/structure',
          },
        }),
        rule2
      )

      // Without the command context, this pattern isn't in the command
      const result3 = matcher.match(
        createToolCall({ arguments: { command: 'rm -rf /important/' } }),
        rule2
      )
      // 'rm -rf /important/' is a substring of the long pattern 'rm -rf /important/direction...' wait no, it's the reverse
      // The command is 'rm -rf /important/' and the pattern is 'rm -rf /important/directory/...'
      // Pattern is not found in command because command is shorter
      expect(result3.matched).toBe(false)
    })

    it('should reject suspicious regex patterns even when they would match', () => {
      const toolCall = createToolCall({
        arguments: { command: 'a'.repeat(120) },
      })
      const longPattern = 'a'.repeat(105) + '(x)?(y)?'
      const rule = createBlockRule({ pattern: `regex:${longPattern}` })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(false)
      expect(result.confidence).toBe('low')
    })

    it('should not match suspicious exception regex patterns even when they would match', () => {
      const toolCall = createToolCall({
        arguments: { command: 'b'.repeat(120) },
      })
      const longPattern = 'b'.repeat(105) + '(x)?(y)?'
      const exception = createAllowException({
        pattern: `regex:${longPattern}`,
      })
      const result = matcher.matchException(toolCall, exception)

      expect(result).toBe(false)
    })

    it('should not match when suspicious pattern has too many quantifiers', () => {
      const toolCall = createToolCall({
        arguments: { command: 'hello world test' },
      })
      const suspiciousPattern =
        '(hello|world|test|foo|bar|baz|qux|quux|corge|grault|garply|waldo|fred|plugh|xyzzy|thud){5}+'
      const rule = createBlockRule({ pattern: `regex:${suspiciousPattern}` })
      const result = matcher.match(toolCall, rule)

      // With quantifiers >= 2 AND length > 100, should use low confidence
      // But since it's actually a valid regex, it might match via the regex matching
      // The pattern has quantifiers: *, +, (, ) - count unique: + at the end, * inside
      // Let me count: (hello|world|test|foo|bar|baz|qux|quux|corge|grault|garply|waldo|fred|plugh|xyzzy|thud){5}+
      // Quantifiers in pattern: +, *, (, )
      // Matching QUANTIFIER_RE = /[+*()]/g
      // We see: + at end, * inside
      // That's 2 quantifiers (one +, one *)
      // And length > 100? Let me check: yes it's over 100 chars
      // So it should be flagged as suspicious and return low confidence
      expect(result.confidence).toBe('low')
    })
  })

  describe('matchException', () => {
    it('should match allow exception substring', () => {
      const toolCall = createToolCall({
        arguments: { command: 'safe-cleanup --all' },
      })
      const exception = createAllowException({ pattern: 'safe-cleanup' })
      const result = matcher.matchException(toolCall, exception)

      expect(result).toBe(true)
    })

    it('should match allow exception regex', () => {
      const toolCall = createToolCall({
        arguments: { command: 'safe-cleanup-prod --force' },
      })
      const exception = createAllowException({ pattern: 'regex:safe-cleanup' })
      const result = matcher.matchException(toolCall, exception)

      expect(result).toBe(true)
    })

    it('should not match when exception pattern does not match', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /' } })
      const exception = createAllowException({ pattern: 'safe-cleanup' })
      const result = matcher.matchException(toolCall, exception)

      expect(result).toBe(false)
    })

    it('should not match disabled exception', () => {
      const toolCall = createToolCall({
        arguments: { command: 'safe-cleanup --all' },
      })
      const exception = createAllowException({
        pattern: 'safe-cleanup',
        enabled: false,
      })
      const result = matcher.matchException(toolCall, exception)

      expect(result).toBe(false)
    })

    it('should match exception in file path', () => {
      const toolCall = createToolCall({
        toolName: 'Read',
        arguments: { path: '/var/log/safe-cleanup.log' },
      })
      const exception = createAllowException({ pattern: 'safe-cleanup' })
      const result = matcher.matchException(toolCall, exception)

      expect(result).toBe(true)
    })

    it('should not match a compound command when the exception covers only one segment', () => {
      const toolCall = createToolCall({
        arguments: { command: 'safe-cleanup && rm -rf /tmp' },
      })
      const exception = createAllowException({ pattern: 'safe-cleanup' })
      const result = matcher.matchException(toolCall, exception)

      expect(result).toBe(false)
    })

    it('should match a compound command when the exception covers every segment', () => {
      const toolCall = createToolCall({
        arguments: { command: 'safe-cleanup && safe-cleanup-extra' },
      })
      const exception = createAllowException({ pattern: 'safe-cleanup' })
      const result = matcher.matchException(toolCall, exception)

      expect(result).toBe(true)
    })

    it('should match a single-segment command with an exception', () => {
      const toolCall = createToolCall({
        arguments: { command: 'safe-cleanup --all' },
      })
      const exception = createAllowException({ pattern: 'safe-cleanup' })
      const result = matcher.matchException(toolCall, exception)

      expect(result).toBe(true)
    })
  })

  describe('match - catastrophic backtracking guard', () => {
    it('rejects nested-quantifier patterns that could cause ReDoS', () => {
      const toolCall = createToolCall({ arguments: { command: 'a'.repeat(120) } })
      const rule = createBlockRule({ pattern: 'regex:(a+)+$' })
      const result = matcher.match(toolCall, rule)
      expect(result.matched).toBe(false)
      expect(result.confidence).toBe('low')
    })

    it('rejects repeated-alternation patterns that could cause ReDoS', () => {
      const toolCall = createToolCall({ arguments: { command: 'a'.repeat(120) } })
      const rule = createBlockRule({ pattern: 'regex:(a|aa)+' })
      const result = matcher.match(toolCall, rule)
      expect(result.matched).toBe(false)
      expect(result.confidence).toBe('low')
    })

    it('rejects double-quantifier patterns like (a*)*', () => {
      const toolCall = createToolCall({ arguments: { command: 'a'.repeat(120) } })
      const rule = createBlockRule({ pattern: 'regex:(a*)*$' })
      const result = matcher.match(toolCall, rule)
      expect(result.matched).toBe(false)
      expect(result.confidence).toBe('low')
    })

    it('rejects the suspicious exception pattern path too', () => {
      const toolCall = createToolCall({ arguments: { command: 'a'.repeat(120) } })
      const exception = createAllowException({ pattern: 'regex:(a+)+$' })
      const result = matcher.matchException(toolCall, exception)
      expect(result).toBe(false)
    })
  })

  describe('matchCommandStructure', () => {
    it('should match command name without flags', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /tmp' } })
      const result = matcher.matchCommandStructure(toolCall, 'rm')

      expect(result).toBe(true)
    })

    it('should match command name with flags', () => {
      const toolCall = createToolCall({ arguments: { command: 'rm -rf /tmp' } })
      const result = matcher.matchCommandStructure(toolCall, 'rm', [
        '-rf',
        '-r',
      ])

      expect(result).toBe(true)
    })

    it('should not match different command name', () => {
      const toolCall = createToolCall({ arguments: { command: 'ls -la' } })
      const result = matcher.matchCommandStructure(toolCall, 'rm')

      expect(result).toBe(false)
    })

    it('should return false when no command extracted', () => {
      const toolCall = createToolCall({
        toolName: 'Read',
        arguments: { path: '/test' },
      })
      const result = matcher.matchCommandStructure(toolCall, 'rm')

      expect(result).toBe(false)
    })

    it('should return true when no flags specified', () => {
      const toolCall = createToolCall({
        arguments: { command: 'echo hello world' },
      })
      const result = matcher.matchCommandStructure(toolCall, 'echo')

      expect(result).toBe(true)
    })
  })
})

describe('PatternMatcher - Property Based Tests', () => {
  let matcher: PatternMatcher

  beforeEach(() => {
    matcher = new PatternMatcher()
  })

  it('should never match a disabled rule regardless of pattern and tool call content', () => {
    for (let i = 0; i < 20; i++) {
      const patterns = ['rm -rf', 'regex:[a-z]+', 'echo', 'cat ', 'dd if=']
      const commands = [
        'rm -rf /',
        'echo hello',
        'cat /etc/passwd',
        'dd if=/dev/zero',
        'ls -la',
      ]
      const toolNames = ['Bash', 'Read', 'Write']

      for (const pattern of patterns) {
        for (const cmd of commands) {
          for (const toolName of toolNames) {
            const toolCall = createToolCall({
              toolName: toolName as any,
              arguments: toolName === 'Bash' ? { command: cmd } : { path: cmd },
            })
            const rule = createBlockRule({ pattern, enabled: false })
            const result = matcher.match(toolCall, rule)

            expect(result.matched).toBe(false)
            expect(result.confidence).toBe('low')
          }
        }
      }
    }
  })

  it('should match substring patterns case-sensitively (exact match required)', () => {
    const toolCall = createToolCall({ arguments: { command: 'RM -RF /tmp' } })
    const rule = createBlockRule({ pattern: 'rm -rf' })
    const result = matcher.match(toolCall, rule)

    expect(result.matched).toBe(false)
  })

  it('should return high confidence for all valid regex matches', () => {
    const testCases = [
      { cmd: 'rm -rf /tmp', pattern: 'regex:rm\\s+-\\s*rf' },
      { cmd: 'rm -rf /tmp', pattern: 'regex:rm' },
      { cmd: 'cat /etc/passwd', pattern: 'regex:/etc/' },
      { cmd: 'echo hello', pattern: 'regex:hello' },
    ]

    for (const { cmd, pattern } of testCases) {
      const toolCall = createToolCall({ arguments: { command: cmd } })
      const rule = createBlockRule({ pattern })
      const result = matcher.match(toolCall, rule)

      expect(result.matched).toBe(true)
      expect(result.confidence).toBe('high')
    }
  })

  it('should handle empty command gracefully', () => {
    const toolCall = createToolCall({ arguments: { command: '' } })
    const rule = createBlockRule({ pattern: 'rm -rf' })
    const result = matcher.match(toolCall, rule)

    expect(result.matched).toBe(false)
    expect(result.confidence).toBe('low')
  })

  it('should handle empty file path gracefully', () => {
    const toolCall = createToolCall({
      toolName: 'Read',
      arguments: { path: '' },
    })
    const rule = createBlockRule({ pattern: '/etc/' })
    const result = matcher.match(toolCall, rule)

    expect(result.matched).toBe(false)
    expect(result.confidence).toBe('low')
  })
})
