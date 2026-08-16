import { SessionState } from '../../../src/state/SessionState'
import { ToolCall } from '../../../src/types/ToolCall'

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolName: 'Bash',
    arguments: { command: 'ls -la' },
    context: {
      agentName: 'general',
      workingDirectory: '/tmp',
      sessionId: 'test-session',
    },
    ...overrides,
  }
}

describe('SessionState', () => {
  let state: SessionState

  beforeEach(() => {
    state = new SessionState()
  })

  describe('initial state', () => {
    it('should start with zero counters', () => {
      const counters = state.getDenialCounters()
      expect(counters.consecutive).toBe(0)
      expect(counters.total).toBe(0)
    })

    it('should start with empty decision history', () => {
      const decisions = state.getRecentDecisions()
      expect(decisions).toHaveLength(0)
    })
  })

  describe('incrementDenial', () => {
    it('should increment consecutive and total counters', () => {
      const toolCall = createToolCall()
      state.incrementDenial(toolCall, 'Dangerous command detected', 'BR-001', 1)

      const counters = state.getDenialCounters()
      expect(counters.consecutive).toBe(1)
      expect(counters.total).toBe(1)
    })

    it('should add decision to history', () => {
      const toolCall = createToolCall()
      state.incrementDenial(toolCall, 'Dangerous command', 'BR-001', 1)

      const decisions = state.getRecentDecisions()
      expect(decisions).toHaveLength(1)
      expect(decisions[0].decision).toBe('deny')
      expect(decisions[0].toolCallName).toBe('Bash')
      expect(decisions[0].blockRule).toBe('BR-001')
      expect(decisions[0].stage).toBe(1)
    })

    it('should increment multiple denials correctly', () => {
      const toolCall = createToolCall()
      state.incrementDenial(toolCall, 'Deny 1', 'BR-001', 1)
      state.incrementDenial(toolCall, 'Deny 2', 'BR-002', 2)
      state.incrementDenial(toolCall, 'Deny 3', 'BR-003', 1)

      const counters = state.getDenialCounters()
      expect(counters.consecutive).toBe(3)
      expect(counters.total).toBe(3)
    })
  })

  describe('incrementAllow', () => {
    it('should reset consecutive counter', () => {
      const toolCall = createToolCall()
      state.incrementDenial(toolCall, 'Deny', 'BR-001', 1)
      state.incrementDenial(toolCall, 'Deny', 'BR-002', 1)
      state.incrementAllow(toolCall, 'Allowed')

      const counters = state.getDenialCounters()
      expect(counters.consecutive).toBe(0)
      expect(counters.total).toBe(2)
    })

    it('should add allow to history', () => {
      const toolCall = createToolCall()
      state.incrementAllow(toolCall, 'Allowed', 1)

      const decisions = state.getRecentDecisions()
      expect(decisions).toHaveLength(1)
      expect(decisions[0].decision).toBe('allow')
    })
  })

  describe('getRecentDecisions', () => {
    it('should limit history to 10 entries', () => {
      const toolCall = createToolCall()
      for (let i = 0; i < 15; i++) {
        state.incrementDenial(
          toolCall,
          `Denial ${i}`,
          `BR-${i.toString().padStart(3, '0')}`,
          1
        )
      }

      const decisions = state.getRecentDecisions()
      expect(decisions).toHaveLength(10)
    })

    it('should respect custom limit parameter', () => {
      const toolCall = createToolCall()
      for (let i = 0; i < 5; i++) {
        state.incrementDenial(toolCall, `Denial ${i}`, 'BR-001', 1)
      }

      const decisions = state.getRecentDecisions(3)
      expect(decisions).toHaveLength(3)
    })
  })

  describe('clear', () => {
    it('should reset all counters and clear history', () => {
      const toolCall = createToolCall()
      state.incrementDenial(toolCall, 'Deny', 'BR-001', 1)
      state.incrementDenial(toolCall, 'Deny', 'BR-002', 1)
      state.incrementAllow(toolCall, 'Allow')
      state.clear()

      const counters = state.getDenialCounters()
      expect(counters.consecutive).toBe(0)
      expect(counters.total).toBe(0)
      expect(state.getRecentDecisions()).toHaveLength(0)
    })
  })

  describe('reset methods', () => {
    it('should reset only consecutive counter', () => {
      state.incrementDenial(createToolCall(), 'Deny', 'BR-001', 1)
      state.incrementDenial(createToolCall(), 'Deny', 'BR-002', 1)
      state.resetConsecutiveDenials()

      expect(state.getDenialCounters().consecutive).toBe(0)
      expect(state.getDenialCounters().total).toBe(2)
    })

    it('should reset only total counter', () => {
      state.incrementDenial(createToolCall(), 'Deny', 'BR-001', 1)
      state.incrementDenial(createToolCall(), 'Deny', 'BR-002', 1)
      state.resetTotalDenials()

      expect(state.getDenialCounters().consecutive).toBe(2)
      expect(state.getDenialCounters().total).toBe(0)
    })
  })
})
