import { PermissionPreChecker } from '../../../src/permissions/PermissionPreChecker'
import { ToolCall } from '../../../src/types/ToolCall'
import { PermissionResult } from '../../../src/types/PermissionTypes'
import { PluginConfig, DEFAULT_CONFIG } from '../../../src/types/PluginConfig'

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolName: 'Read',
    arguments: { path: '/tmp/test.txt' },
    context: {
      agentName: 'general',
      workingDirectory: '/tmp',
      sessionId: 'test',
    },
    ...overrides,
  }
}

describe('PermissionPreChecker', () => {
  let checker: PermissionPreChecker

  beforeEach(() => {
    checker = new PermissionPreChecker()
  })

  describe('checkPermission', () => {
    it('should allow Read tool for general agent', () => {
      const toolCall = createToolCall({ toolName: 'Read' })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('explicit-allow-agent')
    })

    it('should deny Bash tool for general agent (in global deny list)', () => {
      const toolCall = createToolCall({ toolName: 'Bash' })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('not-explicitly-allowed')
    })

    it('should deny tools not in any allow list', () => {
      const toolCall = createToolCall({ toolName: 'DestructiveAction' })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('not-explicitly-allowed')
    })

    it('should allow global allow tools for any agent', () => {
      const toolCall = createToolCall({
        toolName: 'Glob',
        context: {
          agentName: 'unknown',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('explicit-allow-global')
    })

    it('should deny empty tool name', () => {
      const toolCall = createToolCall({ toolName: '' })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('not-explicitly-allowed')
    })

    it('should deny invalid arguments', () => {
      const toolCall = createToolCall({
        arguments: null as unknown as Record<string, unknown>,
      })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('not-explicitly-allowed')
    })

    it('should return not-explicitly-allowed for unknown agents not matching', () => {
      const toolCall = createToolCall({
        toolName: 'Write',
        context: {
          agentName: 'unknown',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('not-explicitly-allowed')
    })
  })

  describe('agent exclusion', () => {
    it('should allow excluded agents immediately', () => {
      checker.setExcludedAgents(['explore', 'research'])

      const toolCall = createToolCall({
        toolName: 'Bash',
        context: {
          agentName: 'explore',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('excluded-agent')
    })

    it('should not exclude non-excluded agents', () => {
      checker.setExcludedAgents(['explore', 'research'])

      const toolCall = createToolCall({
        toolName: 'Bash',
        context: {
          agentName: 'general',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('not-explicitly-allowed')
    })

    it('should allow research agent to execute Bash when excluded', () => {
      checker.setExcludedAgents(['research'])

      const toolCall = createToolCall({
        toolName: 'Bash',
        context: {
          agentName: 'research',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('excluded-agent')
    })

    it('should handle empty exclusion list', () => {
      checker.setExcludedAgents([])

      const toolCall = createToolCall({ toolName: 'Read' })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('explicit-allow-agent')
    })

    it('should not exclude by default when no list set', () => {
      const toolCall = createToolCall({
        toolName: 'Bash',
        context: {
          agentName: 'explore',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(false)
      expect(result.reason).not.toBe('excluded-agent')
    })

    it('should be case-sensitive for agent names', () => {
      checker.setExcludedAgents(['explore'])

      const toolCall1 = createToolCall({
        toolName: 'Bash',
        context: {
          agentName: 'explore',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      expect(checker.checkPermission(toolCall1).reason).toBe('excluded-agent')

      const toolCall2 = createToolCall({
        toolName: 'Bash',
        context: {
          agentName: 'Explore',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      expect(checker.checkPermission(toolCall2).reason).not.toBe(
        'excluded-agent'
      )

      const toolCall3 = createToolCall({
        toolName: 'Bash',
        context: {
          agentName: 'EXPLORE',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      expect(checker.checkPermission(toolCall3).reason).not.toBe(
        'excluded-agent'
      )
    })
  })

  describe('isAgentExcluded', () => {
    it('should return true for excluded agents', () => {
      checker.setExcludedAgents(['explore', 'research'])

      expect(checker.isAgentExcluded('explore')).toBe(true)
      expect(checker.isAgentExcluded('research')).toBe(true)
      expect(checker.isAgentExcluded('general')).toBe(false)
    })
  })

  describe('setConfigFromPlugin', () => {
    it('should load excluded agents from plugin config', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        excludedAgents: ['agent1', 'agent2', 'agent3'],
      } as PluginConfig

      checker.setConfigFromPlugin(config)

      const toolCall = createToolCall({
        toolName: 'Bash',
        context: {
          agentName: 'agent1',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('excluded-agent')
    })

    it('should handle plugin config without excluded agents', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        excludedAgents: [],
      } as PluginConfig

      checker.setConfigFromPlugin(config)

      const toolCall = createToolCall({
        toolName: 'Bash',
        context: {
          agentName: 'general',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(false)
    })
  })

  describe('setAgentPermissions', () => {
    it('should allow custom agent tool permissions', () => {
      checker.setAgentPermissions('custom-agent', ['Read', 'Grep'])
      const toolCall = createToolCall({
        toolName: 'Read',
        context: {
          agentName: 'custom-agent',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      const result = checker.checkPermission(toolCall)

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('explicit-allow-agent')
    })
  })

  describe('permission combination', () => {
    it('should check agent permissions before global permissions', () => {
      checker.setAgentPermissions('test-agent', ['Read'])
      const toolCall = createToolCall({
        toolName: 'Read',
        context: {
          agentName: 'test-agent',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      const result = checker.checkPermission(toolCall)

      expect(result.reason).toBe('explicit-allow-agent')
    })
  })
})
