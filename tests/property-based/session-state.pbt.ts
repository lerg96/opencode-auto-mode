import { SessionState } from '../../src/state/SessionState'
import { ToolCall } from '../../src/types/ToolCall'

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

describe('SessionState - Property-Based Tests', () => {
  it('incrementDenial produces correct counters after N denials', () => {
    for (let n = 1; n <= 100; n++) {
      const state = new SessionState()
      const toolCall = createToolCall()

      for (let i = 0; i < n; i++) {
        state.incrementDenial(toolCall, `denial reason ${i}`)
      }

      const counters = state.getDenialCounters()
      expect(counters.consecutive).toBe(n)
      expect(counters.total).toBe(n)
    }
  })

  it('incrementAllow resets consecutive denials to zero', () => {
    for (let n = 1; n <= 50; n++) {
      const state = new SessionState()
      const toolCall = createToolCall()

      for (let i = 0; i < n; i++) {
        state.incrementDenial(toolCall, `denial reason ${i}`)
      }

      state.incrementAllow(toolCall, 'allowed reason')

      const counters = state.getDenialCounters()
      expect(counters.consecutive).toBe(0)
      expect(counters.total).toBe(n)
    }
  })

  it('mixed allow/deny sequence produces correct counters', () => {
    for (let seq = 0; seq < 20; seq++) {
      const state = new SessionState()
      const toolCall = createToolCall()
      let consecutive = 0
      let total = 0

      for (let i = 0; i < 100; i++) {
        if (i % 3 === 2) {
          // Every 3rd action is allow
          state.incrementAllow(toolCall, 'allowed reason')
          consecutive = 0
        } else {
          state.incrementDenial(toolCall, 'denial reason')
          consecutive++
          total++
        }
      }

      const counters = state.getDenialCounters()
      expect(counters.consecutive).toBe(consecutive)
      expect(counters.total).toBe(total)
    }
  })

  it('clear resets all state', () => {
    for (let n = 1; n <= 50; n++) {
      const state = new SessionState()
      const toolCall = createToolCall()

      for (let i = 0; i < n; i++) {
        state.incrementDenial(toolCall, `denial reason ${i}`)
      }

      state.clear()

      const counters = state.getDenialCounters()
      expect(counters.consecutive).toBe(0)
      expect(counters.total).toBe(0)
      expect(state.getRecentDecisions().length).toBe(0)
    }
  })

  it('resetConsecutiveDenials only resets consecutive counter', () => {
    for (let n = 1; n <= 50; n++) {
      const state = new SessionState()
      const toolCall = createToolCall()

      for (let i = 0; i < n; i++) {
        state.incrementDenial(toolCall, 'denial reason')
      }

      state.resetConsecutiveDenials()

      expect(state.getConsecutiveDenialCount()).toBe(0)
      expect(state.getTotalDenialCount()).toBe(n)
    }
  })

  it('resetTotalDenials only resets total counter', () => {
    for (let n = 1; n <= 50; n++) {
      const state = new SessionState()
      const toolCall = createToolCall()

      for (let i = 0; i < n; i++) {
        state.incrementDenial(toolCall, 'denial reason')
      }

      state.resetTotalDenials()

      expect(state.getConsecutiveDenialCount()).toBe(n)
      expect(state.getTotalDenialCount()).toBe(0)
    }
  })

  it('recent decisions are capped at MAX_DECISION_HISTORY (10)', () => {
    const state = new SessionState()
    const toolCall = createToolCall()

    for (let i = 0; i < 50; i++) {
      state.incrementDenial(toolCall, `denial reason ${i}`)
    }

    const decisions = state.getRecentDecisions()
    expect(decisions.length).toBe(10)
  })

  it('recent decisions are returned in FIFO order (oldest first)', () => {
    const state = new SessionState()
    const toolCall = createToolCall()

    for (let i = 0; i < 15; i++) {
      state.incrementDenial(toolCall, `denial reason ${i}`)
    }

    const decisions = state.getRecentDecisions()
    expect(decisions.length).toBe(10)
    expect(decisions[0].reasoning).toBe('denial reason 5')
    expect(decisions[9].reasoning).toBe('denial reason 14')
  })

  it('getRecentDecisions with limit returns subset', () => {
    const state = new SessionState()
    const toolCall = createToolCall()

    for (let i = 0; i < 20; i++) {
      state.incrementDenial(toolCall, `denial reason ${i}`)
    }

    const decisions3 = state.getRecentDecisions(3)
    expect(decisions3.length).toBe(3)
    expect(decisions3[0].reasoning).toBe('denial reason 17')
    expect(decisions3[2].reasoning).toBe('denial reason 19')

    const decisionsAll = state.getRecentDecisions()
    expect(decisionsAll.length).toBe(10)
  })

  it('getRecentDecisions clamps negative and zero limits', () => {
    const state = new SessionState()
    const toolCall = createToolCall()

    for (let i = 0; i < 10; i++) {
      state.incrementDenial(toolCall, `denial reason ${i}`)
    }

    expect(state.getRecentDecisions(-1).length).toBe(0)
    expect(state.getRecentDecisions(-100).length).toBe(0)
    expect(state.getRecentDecisions(0).length).toBe(0)
    expect(state.getRecentDecisions(5).length).toBe(5)
  })

  it('allow resets consecutive but does not affect total', () => {
    for (let seq = 0; seq < 10; seq++) {
      const state = new SessionState()
      const toolCall = createToolCall()

      // 5 denials
      for (let i = 0; i < 5; i++) {
        state.incrementDenial(toolCall, 'denial reason')
      }
      expect(state.getConsecutiveDenialCount()).toBe(5)
      expect(state.getTotalDenialCount()).toBe(5)

      // 1 allow
      state.incrementAllow(toolCall, 'allowed reason')
      expect(state.getConsecutiveDenialCount()).toBe(0)
      expect(state.getTotalDenialCount()).toBe(5)

      // 3 more denials
      for (let i = 0; i < 3; i++) {
        state.incrementDenial(toolCall, 'denial reason')
      }
      expect(state.getConsecutiveDenialCount()).toBe(3)
      expect(state.getTotalDenialCount()).toBe(8)
    }
  })
})
