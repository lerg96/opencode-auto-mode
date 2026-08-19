import { ToolCall } from '../../../src/types/ToolCall'
import { PermissionPreChecker } from '../../../src/permissions/PermissionPreChecker'

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

describe('PermissionPreChecker - global permission methods', () => {
  let checker: PermissionPreChecker

  beforeEach(() => {
    checker = new PermissionPreChecker()
  })

  describe('addGlobalAllowPermission', () => {
    it('should add a tool to global allow list', () => {
      checker.addGlobalAllowPermission('DestructiveAction')
      const toolCall = createToolCall({
        toolName: 'DestructiveAction',
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

    it('should not add duplicate permission', () => {
      checker.addGlobalAllowPermission('Glob')
      checker.addGlobalAllowPermission('Glob')
      const toolCall = createToolCall({ toolName: 'Glob' })
      // Just ensure no error is thrown and still allows
      expect(checker.checkPermission(toolCall).allowed).toBe(true)
    })

    it('should not affect other permission sets when adding', () => {
      checker.addGlobalAllowPermission('CustomTool')
      // Bash should still be denied (global deny list)
      const bashCall = createToolCall({ toolName: 'Bash' })
      expect(checker.checkPermission(bashCall).allowed).toBe(false)
    })
  })

  describe('addGlobalDenyPermission', () => {
    it('should add a tool to global deny list', () => {
      checker.addGlobalDenyPermission('Read')
      const toolCall = createToolCall({
        toolName: 'Read',
        context: {
          agentName: 'general',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      const result = checker.checkPermission(toolCall)
      // Even though 'Read' is in agent permissions, global deny takes effect
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('not-explicitly-allowed')
    })

    it('should not add duplicate denial', () => {
      checker.addGlobalDenyPermission('Bash')
      checker.addGlobalDenyPermission('Bash')
      const toolCall = createToolCall({ toolName: 'Bash' })
      expect(checker.checkPermission(toolCall).allowed).toBe(false)
    })

    it('should allow agent permission to pass before checking global deny', () => {
      checker.setAgentPermissions('custom', ['Write'])
      checker.addGlobalDenyPermission('Write')
      const toolCall = createToolCall({
        toolName: 'Write',
        context: {
          agentName: 'custom',
          workingDirectory: '/',
          sessionId: 'test',
        },
      })
      // Agent permission is checked first, then global deny blocks it
      expect(checker.checkPermission(toolCall).allowed).toBe(false)
    })
  })
})
