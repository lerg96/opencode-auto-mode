import {
  ToolCall,
  matchesPattern,
  extractCommand,
  extractFilePath,
} from '../../../src/types/ToolCall'
import {
  createInjectionResult,
  InjectionResult,
} from '../../../src/injection/types'

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

describe('ToolCall matchesPattern', () => {
  it('should match command string case-insensitively', () => {
    const toolCall = createToolCall({
      arguments: { command: 'rm -rf /tmp' },
    })
    expect(matchesPattern(toolCall, 'rm -rf')).toBe(true)
    expect(matchesPattern(toolCall, 'RM -RF')).toBe(true)
    // '[-]' is a regex char class - in substring mode via new RegExp, [-] is literal '-'
    expect(matchesPattern(toolCall, 'rm [-]rf')).toBe(true)
  })

  it('should match file path case-insensitively', () => {
    const toolCall = createToolCall({
      toolName: 'Read',
      arguments: { path: '/etc/passwd' },
    })
    expect(matchesPattern(toolCall, '/etc/passwd')).toBe(true)
    expect(matchesPattern(toolCall, '/ETC/PASSWD')).toBe(true)
  })

  it('should match arguments JSON', () => {
    const toolCall: ToolCall = createToolCall({
      toolName: 'Bash',
      arguments: { command: 'echo hello', flag: '--verbose' },
    })
    expect(matchesPattern(toolCall, 'verbose')).toBe(true)
    expect(matchesPattern(toolCall, 'flag')).toBe(true)
  })

  it('should return false when pattern does not match command', () => {
    const toolCall = createToolCall({
      arguments: { command: 'cat /etc/hosts' },
    })
    expect(matchesPattern(toolCall, 'rm -rf')).toBe(false)
  })

  it('should return false when pattern does not match file path', () => {
    const toolCall = createToolCall({
      toolName: 'Write',
      arguments: { path: '/var/log/app.log' },
    })
    expect(matchesPattern(toolCall, '/etc/passwd')).toBe(false)
  })

  it('should return false when pattern does not match arguments', () => {
    const toolCall = createToolCall({
      arguments: { command: 'ls -la', count: 5 },
    })
    expect(matchesPattern(toolCall, 'nonexistent_pattern')).toBe(false)
  })

  it('should match regex pattern in command (pattern is passed as a regex string)', () => {
    const toolCall = createToolCall({
      arguments: { command: 'rm -rf /important' },
    })
    // matchesPattern wraps pattern in new RegExp(pattern, 'i')
    // 'rm\\s+.*rf' as a regex string matches 'rm -rf /important'
    expect(matchesPattern(toolCall, 'rm.*rf')).toBe(true)
  })

  it('should match regex pattern in file path', () => {
    const toolCall = createToolCall({
      toolName: 'Read',
      arguments: { path: '/etc/nginx/nginx.conf' },
    })
    expect(matchesPattern(toolCall, '/etc/.*')).toBe(true)
  })

  it('should match regex pattern in arguments JSON', () => {
    const toolCall: ToolCall = createToolCall({
      arguments: { command: 'test', username: 'admin_user' },
    })
    // '.*_user' as regex matches 'admin_user' in the JSON string
    expect(matchesPattern(toolCall, '_user')).toBe(true)
  })

  it('should handle non-Bash tool matching against args JSON', () => {
    const toolCall: ToolCall = {
      toolName: 'Grep',
      arguments: { pattern: 'foo', path: 'bar' },
      context: {
        agentName: 'general',
        workingDirectory: '/tmp',
        sessionId: 'test',
      },
    }
    expect(matchesPattern(toolCall, 'foo')).toBe(true)
  })

  it('should try regex on args JSON as last resort', () => {
    const toolCall: ToolCall = {
      toolName: 'Grep',
      arguments: { path: '/tmp/test' },
      context: {
        agentName: 'general',
        workingDirectory: '/tmp',
        sessionId: 'test',
      },
    }
    // No command → no filePath → tries JSON.stringify(arguments)
    // '{\"path\":\"/tmp/test\"}' contains '/tmp'
    expect(matchesPattern(toolCall, '/tmp/test')).toBe(true)
  })
})

describe('ToolCall extractCommand', () => {
  it('should extract command from Bash tool', () => {
    const toolCall = createToolCall({ arguments: { command: 'ls -la' } })
    expect(extractCommand(toolCall)).toBe('ls -la')
  })

  it('should return null for non-Bash tool', () => {
    const toolCall = createToolCall({ toolName: 'Read' })
    expect(extractCommand(toolCall)).toBeNull()
  })

  it('should return null for empty command', () => {
    const toolCall = createToolCall({ arguments: { command: '' } })
    expect(extractCommand(toolCall)).toBeNull()
  })

  it('should return null for non-string command', () => {
    const toolCall = {
      toolName: 'Bash',
      arguments: { command: 123 as unknown as string },
      context: {
        agentName: 'general',
        workingDirectory: '/tmp',
        sessionId: 'test',
      },
    } as ToolCall
    expect(extractCommand(toolCall)).toBeNull()
  })
})

describe('ToolCall extractFilePath', () => {
  it('should extract path from Read tool', () => {
    const toolCall = createToolCall({
      toolName: 'Read',
      arguments: { path: '/tmp/test.txt' },
    })
    expect(extractFilePath(toolCall)).toBe('/tmp/test.txt')
  })

  it('should extract path from Write tool', () => {
    const toolCall = createToolCall({
      toolName: 'Write',
      arguments: { path: '/tmp/test.txt' },
    })
    expect(extractFilePath(toolCall)).toBe('/tmp/test.txt')
  })

  it('should return null for Bash tool', () => {
    const toolCall = createToolCall({ toolName: 'Bash' })
    expect(extractFilePath(toolCall)).toBeNull()
  })

  it('should return null for empty path', () => {
    const toolCall = createToolCall({
      toolName: 'Read',
      arguments: { path: '' },
    })
    expect(extractFilePath(toolCall)).toBeNull()
  })
})

describe('createInjectionResult', () => {
  it('should create result with injected=true', () => {
    const result = createInjectionResult(
      true,
      'pattern text',
      'hidden-system-prompt'
    )
    expect(result).toEqual<InjectionResult>({
      injected: true,
      pattern: 'pattern text',
      patternType: 'hidden-system-prompt',
      overrideDecision: 'manual-review',
    })
  })

  it('should create result with injected=false', () => {
    const result = createInjectionResult(false, undefined, undefined)
    expect(result).toEqual<InjectionResult>({
      injected: false,
      pattern: undefined,
      patternType: undefined,
      overrideDecision: 'proceed',
    })
  })

  it('should always set manual-review when injected', () => {
    const result = createInjectionResult(true)
    expect(result.overrideDecision).toBe('manual-review')
  })

  it('should always set proceed when not injected', () => {
    const result = createInjectionResult(false, 'some pattern', 'custom')
    expect(result.overrideDecision).toBe('proceed')
  })

  it('should create result without optional fields', () => {
    const result = createInjectionResult(true, undefined, undefined)
    expect(result.injected).toBe(true)
    expect(result.pattern).toBeUndefined()
    expect(result.patternType).toBeUndefined()
    expect(result.overrideDecision).toBe('manual-review')
  })
})
