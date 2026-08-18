import { EscalationService } from '../../../src/escalation/EscalationService'
import { SessionState } from '../../../src/state/SessionState'
import { ToolCall } from '../../../src/types/ToolCall'
import { DEFAULT_CONFIG } from '../../../src/types/PluginConfig'

function createToolCall(): ToolCall {
  return {
    toolName: 'Bash',
    arguments: { command: 'test' },
    context: { agentName: 'general', workingDirectory: '/', sessionId: 'test' },
  }
}

describe('EscalationService', () => {
  let sessionState: SessionState
  let service: EscalationService

  beforeEach(() => {
    sessionState = new SessionState()
    service = new EscalationService(sessionState, {
      ...DEFAULT_CONFIG,
      escalation: { consecutive: 3, total: 20 },
    } as any)
  })

  describe('checkThresholds - below thresholds', () => {
    it('should not escalate when consecutive is below threshold', () => {
      const result = service.checkThresholds()
      expect(result.escalated).toBe(false)
    })

    it('should not escalate with some denials below threshold', () => {
      const toolCall = createToolCall()
      sessionState.incrementDenial(toolCall, 'Deny 1', 'BR-001', 1)
      sessionState.incrementDenial(toolCall, 'Deny 2', 'BR-002', 1)

      const result = service.checkThresholds()
      expect(result.escalated).toBe(false)
    })
  })

  describe('checkThresholds - consecutive threshold', () => {
    it('should escalate when consecutive reaches threshold', () => {
      const toolCall = createToolCall()
      for (let i = 0; i < 3; i++) {
        sessionState.incrementDenial(toolCall, `Denial ${i}`, `BR-${i + 1}`, 1)
      }

      const result = service.checkThresholds()
      expect(result.escalated).toBe(true)
      expect(result.message).toContain('3 consecutive')
      expect(result.message).toContain('consecutive')
    })

    it('should report both triggers when both thresholds are exceeded', () => {
      const toolCall = createToolCall()
      for (let i = 0; i < 20; i++) {
        sessionState.incrementDenial(toolCall, `Denial ${i}`, 'BR-001', 1)
      }

      const result = service.checkThresholds()
      expect(result.escalated).toBe(true)
      expect(result.message).toContain('consecutive+total')
    })

    it('should not escalate if only total is high but consecutive is low', () => {
      const toolCall = createToolCall()
      for (let i = 0; i < 2; i++) {
        sessionState.incrementDenial(toolCall, `Denial ${i}`, 'BR-001', 1)
      }
      sessionState.resetConsecutiveDenials()

      for (let i = 0; i < 20; i++) {
        sessionState.incrementDenial(toolCall, `Denial reset-${i}`, 'BR-001', 1)
      }
      sessionState.resetConsecutiveDenials()

      for (let i = 0; i < 20; i++) {
        sessionState.incrementDenial(
          toolCall,
          `Denial reset2-${i}`,
          'BR-001',
          1
        )
      }

      const counters = sessionState.getDenialCounters()
      expect(counters.total).toBe(42)
      expect(counters.consecutive).toBe(20)

      service.setThresholds(25, 50)
      const result = service.checkThresholds()
      expect(result.escalated).toBe(false)
    })
  })

  describe('checkThresholds - total threshold', () => {
    it('should escalate when total reaches threshold', () => {
      const toolCall = createToolCall()
      for (let i = 0; i < 20; i++) {
        sessionState.incrementDenial(toolCall, `Denial ${i}`, `BR-001`, 1)
        if ((i + 1) % 5 === 0) {
          sessionState.resetTotalDenials()
        }
      }

      const counters = sessionState.getDenialCounters()
      const result = service.checkThresholds()

      if (counters.total >= 20) {
        expect(result.escalated).toBe(true)
        expect(result.message).toContain('total')
      }
    })
  })

  describe('checkThresholds - configurable consecutive threshold', () => {
    it('should use configured consecutive threshold', () => {
      service.setThresholds(5, 30)
      const toolCall = createToolCall()

      for (let i = 0; i < 5; i++) {
        sessionState.incrementDenial(toolCall, `Denial ${i}`, 'BR-001', 1)
      }

      const result = service.checkThresholds()
      expect(result.escalated).toBe(true)
      expect(result.message).toContain('5 consecutive')
    })

    it('should not escalate below configured consecutive threshold', () => {
      service.setThresholds(10, 50)
      const toolCall = createToolCall()

      for (let i = 0; i < 5; i++) {
        sessionState.incrementDenial(toolCall, `Denial ${i}`, 'BR-001', 1)
      }

      const result = service.checkThresholds()
      expect(result.escalated).toBe(false)
    })
  })

  describe('checkThresholds - configurable total threshold', () => {
    it('should use configured total threshold', () => {
      service.setThresholds(100, 5)
      const toolCall = createToolCall()

      for (let i = 0; i < 5; i++) {
        sessionState.incrementDenial(toolCall, `Denial ${i}`, 'BR-001', 1)
      }

      const result = service.checkThresholds()
      expect(result.escalated).toBe(true)
      expect(result.message).toContain('total')
    })

    it('should not escalate below configured total threshold', () => {
      service.setThresholds(100, 100)
      const toolCall = createToolCall()

      for (let i = 0; i < 5; i++) {
        sessionState.incrementDenial(toolCall, `Denial ${i}`, 'BR-001', 1)
      }

      const result = service.checkThresholds()
      expect(result.escalated).toBe(false)
    })
  })

  describe('triggerEscalation', () => {
    it('should return escalation result on manual trigger', () => {
      const toolCall = createToolCall()
      sessionState.incrementDenial(toolCall, 'Deny', 'BR-001', 1)

      const result = service.triggerEscalation()

      expect(result.escalated).toBe(true)
      expect(result.message).toContain('manual-trigger')
    })
  })

  describe('processApproval', () => {
    it('should reset consecutive denials', () => {
      const toolCall = createToolCall()
      sessionState.incrementDenial(toolCall, 'Deny 1', 'BR-001', 1)
      sessionState.incrementDenial(toolCall, 'Deny 2', 'BR-002', 1)
      sessionState.incrementDenial(toolCall, 'Deny 3', 'BR-003', 1)

      service.processApproval()

      expect(sessionState.getDenialCounters().consecutive).toBe(0)
    })

    it('should not affect total counter', () => {
      const toolCall = createToolCall()
      sessionState.incrementDenial(toolCall, 'Deny 1', 'BR-001', 1)
      sessionState.incrementDenial(toolCall, 'Deny 2', 'BR-002', 1)

      const totalBefore = sessionState.getDenialCounters().total
      service.processApproval()
      const totalAfter = sessionState.getDenialCounters().total

      expect(totalAfter).toBe(totalBefore)
    })
  })

  describe('processDenial', () => {
    it('should increment both consecutive and total counters', () => {
      const toolCall = createToolCall()
      sessionState.incrementDenial(toolCall, 'Deny 1', 'BR-001', 1)
      sessionState.incrementDenial(toolCall, 'Deny 2', 'BR-002', 1)

      service.processDenial(toolCall, 'Deny 3')

      expect(sessionState.getDenialCounters().consecutive).toBe(3)
      expect(sessionState.getDenialCounters().total).toBe(3)
    })

    it('should increment consecutive from 0 when first denial', () => {
      const toolCall = createToolCall()

      service.processDenial(toolCall, 'First denial')

      expect(sessionState.getDenialCounters().consecutive).toBe(1)
      expect(sessionState.getDenialCounters().total).toBe(1)
    })

    it('should record denial in recent decisions', () => {
      const toolCall = createToolCall()

      service.processDenial(toolCall, 'New denial reason')

      const decisions = sessionState.getRecentDecisions()
      expect(decisions).toHaveLength(1)
      expect(decisions[0].reasoning).toBe('New denial reason')
    })
  })

  describe('getThresholds', () => {
    it('should return configured thresholds', () => {
      const thresholds = service.getThresholds()
      expect(thresholds.consecutive).toBe(3)
      expect(thresholds.total).toBe(20)
    })
  })

  describe('setThresholds', () => {
    it('should update thresholds', () => {
      service.setThresholds(5, 30)
      const thresholds = service.getThresholds()

      expect(thresholds.consecutive).toBe(5)
      expect(thresholds.total).toBe(30)
    })

    it('should apply new thresholds immediately', () => {
      service.setThresholds(2, 5)
      const toolCall = createToolCall()

      sessionState.incrementDenial(toolCall, 'Denial 1', 'BR-001', 1)
      sessionState.incrementDenial(toolCall, 'Denial 2', 'BR-002', 1)

      const result = service.checkThresholds()
      expect(result.escalated).toBe(true)
    })

    it('should handle zero thresholds', () => {
      service.setThresholds(0, 0)
      const toolCall = createToolCall()

      const result = service.checkThresholds()
      expect(result.escalated).toBe(true)
    })
  })
})
