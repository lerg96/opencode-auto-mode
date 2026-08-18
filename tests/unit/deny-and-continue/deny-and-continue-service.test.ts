import { DenyAndContinueService } from '../../../src/deny-and-continue/DenyAndContinueService'
import { SessionState } from '../../../src/state/SessionState'
import { ClassificationResult } from '../../../src/types/ClassificationResult'
import { DEFAULT_CONFIG } from '../../../src/types/PluginConfig'

function createDenialResult(
  overrides: Partial<ClassificationResult> = {}
): ClassificationResult {
  return {
    decision: 'deny',
    reasoning: 'Action blocked by security policy',
    blockRule: 'BR-001',
    stage: 1,
    timestamp: new Date(),
    ...overrides,
  }
}

describe('DenyAndContinueService', () => {
  describe('auto-retry mode', () => {
    it('should return auto-retry result', async () => {
      const sessionState = new SessionState()
      const config = { ...DEFAULT_CONFIG, denyMode: 'auto-retry' }
      const service = new DenyAndContinueService(config as any, sessionState)

      const result = await service.handleDeny(createDenialResult())

      expect(result.type).toBe('auto-retry')
      expect(result.message).toContain('Action blocked by auto-mode rule')
      expect(result.requiresUserApproval).toBeUndefined()
    })
  })

  describe('ask-user mode', () => {
    it('should return ask-user result', async () => {
      const sessionState = new SessionState()
      const config = { ...DEFAULT_CONFIG, denyMode: 'ask-user' }
      const service = new DenyAndContinueService(config as any, sessionState)

      const result = await service.handleDeny(createDenialResult())

      expect(result.type).toBe('ask-user')
      expect(result.message).toContain('Auto-mode blocked action')
      expect(result.requiresUserApproval).toBe(true)
    })
  })

  describe('both mode', () => {
    it('should return auto-retry when below consecutive threshold', async () => {
      const sessionState = new SessionState()
      const config = { ...DEFAULT_CONFIG, denyMode: 'both' }
      const service = new DenyAndContinueService(config as any, sessionState)

      const result = await service.handleDeny(createDenialResult())

      expect(result.type).toBe('auto-retry')
    })

    it('should return ask-user when consecutive threshold is reached', async () => {
      const sessionState = new SessionState()
      const config = { ...DEFAULT_CONFIG, denyMode: 'both' }
      const service = new DenyAndContinueService(config as any, sessionState)

      for (let i = 0; i < 3; i++) {
        sessionState.incrementDenial(
          {
            toolName: 'Bash',
            arguments: { command: 'test' },
            context: {
              agentName: 'general',
              workingDirectory: '/',
              sessionId: 'test',
            },
          },
          `Denial ${i}`,
          'BR-001',
          1
        )
      }

      const result = await service.handleDeny(createDenialResult())

      expect(result.type).toBe('ask-user')
      expect(result.requiresUserApproval).toBe(true)
    })

    it('should use configured escalation threshold for both mode', async () => {
      const sessionState = new SessionState()
      const config = {
        ...DEFAULT_CONFIG,
        denyMode: 'both',
        escalation: { consecutive: 5, total: 20 },
      }
      const service = new DenyAndContinueService(config as any, sessionState)

      for (let i = 0; i < 4; i++) {
        sessionState.incrementDenial(
          {
            toolName: 'Bash',
            arguments: { command: 'test' },
            context: {
              agentName: 'general',
              workingDirectory: '/',
              sessionId: 'test',
            },
          },
          `Denial ${i}`,
          'BR-001',
          1
        )
      }

      const result = await service.handleDeny(createDenialResult())
      expect(result.type).toBe('auto-retry')

      sessionState.incrementDenial(
        {
          toolName: 'Bash',
          arguments: { command: 'test' },
          context: {
            agentName: 'general',
            workingDirectory: '/',
            sessionId: 'test',
          },
        },
        `Denial 5`,
        'BR-001',
        1
      )

      const result2 = await service.handleDeny(createDenialResult())
      expect(result2.type).toBe('ask-user')
      expect(result2.requiresUserApproval).toBe(true)
    })
  })

  describe('setDenyMode', () => {
    it('should change deny mode at runtime', async () => {
      const sessionState = new SessionState()
      const config = { ...DEFAULT_CONFIG, denyMode: 'auto-retry' }
      const service = new DenyAndContinueService(config as any, sessionState)

      service.setDenyMode('ask-user')
      expect(service.getDenyMode()).toBe('ask-user')

      const result = await service.handleDeny(createDenialResult())
      expect(result.type).toBe('ask-user')
    })

    it('should change to both mode', async () => {
      const sessionState = new SessionState()
      const config = { ...DEFAULT_CONFIG, denyMode: 'auto-retry' }
      const service = new DenyAndContinueService(config as any, sessionState)

      service.setDenyMode('both')
      expect(service.getDenyMode()).toBe('both')
    })

    it('should change to auto-retry mode', async () => {
      const sessionState = new SessionState()
      const config = { ...DEFAULT_CONFIG, denyMode: 'ask-user' }
      const service = new DenyAndContinueService(config as any, sessionState)

      service.setDenyMode('auto-retry')
      expect(service.getDenyMode()).toBe('auto-retry')
    })

    it('should default to auto-retry for unknown modes', async () => {
      const sessionState = new SessionState()
      const config = { ...DEFAULT_CONFIG, denyMode: 'auto-retry' }
      const service = new DenyAndContinueService(config as any, sessionState)

      service.setDenyMode('weird-mode' as any)

      const result = await service.handleDeny(createDenialResult())
      expect(result.type).toBe('auto-retry')
    })
  })

  describe('without blockRule', () => {
    it('should format message without rule info in auto-retry', async () => {
      const sessionState = new SessionState()
      const config = { ...DEFAULT_CONFIG, denyMode: 'auto-retry' }
      const service = new DenyAndContinueService(config as any, sessionState)

      const result = await service.handleDeny(
        createDenialResult({ blockRule: undefined })
      )

      expect(result.type).toBe('auto-retry')
      expect(result.message).not.toContain('[')
    })
  })

  describe('with blockRule', () => {
    it('should format message with rule info in auto-retry', async () => {
      const sessionState = new SessionState()
      const config = { ...DEFAULT_CONFIG, denyMode: 'auto-retry' }
      const service = new DenyAndContinueService(config as any, sessionState)

      const result = await service.handleDeny(
        createDenialResult({ blockRule: 'BR-005' })
      )

      expect(result.type).toBe('auto-retry')
      expect(result.message).toContain('[BR-005]')
    })
  })

  describe('deny mode consistency', () => {
    it('should always return consistent type from getDenyMode and handleDeny', async () => {
      const sessionState = new SessionState()
      const config = { ...DEFAULT_CONFIG, denyMode: 'ask-user' }
      const service = new DenyAndContinueService(config as any, sessionState)

      expect(service.getDenyMode()).toBe('ask-user')
      const result = await service.handleDeny(createDenialResult())
      expect(result.type).toBe('ask-user')
    })

    it('should reflect deny mode changes in subsequent calls', async () => {
      const sessionState = new SessionState()
      const config = { ...DEFAULT_CONFIG, denyMode: 'auto-retry' }
      const service = new DenyAndContinueService(config as any, sessionState)

      let result = await service.handleDeny(createDenialResult())
      expect(result.type).toBe('auto-retry')

      service.setDenyMode('ask-user')
      result = await service.handleDeny(createDenialResult())
      expect(result.type).toBe('ask-user')
    })
  })
})
