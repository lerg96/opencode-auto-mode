import fc from 'fast-check'
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
  const bashCallArb = fc.record({
    toolName: fc.constant('Bash' as any),
    arguments: fc.record({ command: fc.string() }),
    context: fc.record({
      agentName: fc.string(),
      workingDirectory: fc.string(),
      sessionId: fc.string(),
    }),
  })

  const denialReasonArb = fc.fullUnicodeString().filter((s) => s.length <= 40)

  const posInt50Arb = fc.integer({ min: 1, max: 50 })
  const posInt100Arb = fc.integer({ min: 1, max: 100 })

  describe('Denial counter properties', () => {
    it('incrementDenial increments both counters by exactly one per call', () => {
      fc.assert(
        fc.property(posInt100Arb, bashCallArb, denialReasonArb, (n, call, reason) => {
          const state = new SessionState()
          for (let i = 0; i < n; i++) {
            state.incrementDenial(call, `${reason}-${i}`)
          }
          const counters = state.getDenialCounters()
          expect(counters.consecutive).toBe(n)
          expect(counters.total).toBe(n)
        })
      )
    })

    it('incrementAllow resets consecutive to zero while preserving total', () => {
      fc.assert(
        fc.property(posInt50Arb, bashCallArb, denialReasonArb, (n, call, reason) => {
          const state = new SessionState()
          for (let i = 0; i < n; i++) {
            state.incrementDenial(call, `${reason}-${i}`)
          }
          state.incrementAllow(call, 'allowed')
          const counters = state.getDenialCounters()
          expect(counters.consecutive).toBe(0)
          expect(counters.total).toBe(n)
        })
      )
    })

    it('mixed allow/deny sequence tracks counters deterministically', () => {
      fc.assert(
        fc.property(bashCallArb, denialReasonArb, (call, reason) => {
          const state = new SessionState()
          let consecutive = 0
          let total = 0
          for (let i = 0; i < 100; i++) {
            if (i % 3 === 2) {
              state.incrementAllow(call, 'allowed')
              consecutive = 0
            } else {
              state.incrementDenial(call, reason)
              consecutive++
              total++
            }
          }
          const counters = state.getDenialCounters()
          expect(counters.consecutive).toBe(consecutive)
          expect(counters.total).toBe(total)
        })
      )
    })
  })

  describe('Reset and clear properties', () => {
    it('clear resets all counters and decision history', () => {
      fc.assert(
        fc.property(posInt50Arb, bashCallArb, denialReasonArb, (n, call, reason) => {
          const state = new SessionState()
          for (let i = 0; i < n; i++) {
            state.incrementDenial(call, `${reason}-${i}`)
          }
          state.clear()
          expect(state.getDenialCounters().consecutive).toBe(0)
          expect(state.getDenialCounters().total).toBe(0)
          expect(state.getRecentDecisions().length).toBe(0)
        })
      )
    })

    it('resetConsecutiveDenials resets only consecutive counter', () => {
      fc.assert(
        fc.property(posInt50Arb, bashCallArb, denialReasonArb, (n, call, reason) => {
          const state = new SessionState()
          for (let i = 0; i < n; i++) {
            state.incrementDenial(call, reason)
          }
          state.resetConsecutiveDenials()
          expect(state.getConsecutiveDenialCount()).toBe(0)
          expect(state.getTotalDenialCount()).toBe(n)
        })
      )
    })

    it('resetTotalDenials resets only total counter', () => {
      fc.assert(
        fc.property(posInt50Arb, bashCallArb, denialReasonArb, (n, call, reason) => {
          const state = new SessionState()
          for (let i = 0; i < n; i++) {
            state.incrementDenial(call, reason)
          }
          state.resetTotalDenials()
          expect(state.getConsecutiveDenialCount()).toBe(n)
          expect(state.getTotalDenialCount()).toBe(0)
        })
      )
    })

    it('allow resets consecutive but leaves total unchanged', () => {
      fc.assert(
        fc.property(bashCallArb, denialReasonArb, (call, reason) => {
          const state = new SessionState()
          for (let i = 0; i < 5; i++) {
            state.incrementDenial(call, reason)
          }
          state.incrementAllow(call, 'allowed')
          expect(state.getConsecutiveDenialCount()).toBe(0)
          expect(state.getTotalDenialCount()).toBe(5)
          for (let i = 0; i < 3; i++) {
            state.incrementDenial(call, reason)
          }
          expect(state.getConsecutiveDenialCount()).toBe(3)
          expect(state.getTotalDenialCount()).toBe(8)
        })
      )
    })
  })

  describe('Decision history properties', () => {
    it('recent decisions are capped at MAX_DECISION_HISTORY (10) for any number of denials', () => {
      fc.assert(
        fc.property(fc.nat({ max: 200 }), bashCallArb, denialReasonArb, (n, call, reason) => {
          const state = new SessionState()
          for (let i = 0; i < n; i++) {
            state.incrementDenial(call, `${reason}-${i}`)
          }
          const decisions = state.getRecentDecisions()
          expect(decisions.length).toBeLessThanOrEqual(10)
          if (n <= 10) {
            expect(decisions.length).toBe(n)
          }
        })
      )
    })

    it('recent decisions are returned in FIFO order for entries within the window', () => {
      fc.assert(
        fc.property(bashCallArb, denialReasonArb, (call, reason) => {
          const state = new SessionState()
          for (let i = 0; i < 15; i++) {
            state.incrementDenial(call, `${reason}-${i}`)
          }
          const decisions = state.getRecentDecisions()
          expect(decisions.length).toBe(10)
          expect(decisions[0].reasoning).toBe(`${reason}-5`)
          expect(decisions[9].reasoning).toBe(`${reason}-14`)
        })
      )
    })

    it('getRecentDecisions with a positive limit returns the requested tail subset', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 10 }),
          bashCallArb,
          denialReasonArb,
          (limit, call, reason) => {
            const state = new SessionState()
            for (let i = 0; i < 20; i++) {
              state.incrementDenial(call, `${reason}-${i}`)
            }
            const decisions = state.getRecentDecisions(limit)
            expect(decisions.length).toBe(limit)
            expect(decisions[0].reasoning).toBe(`${reason}-${20 - limit}`)
            expect(decisions[limit - 1].reasoning).toBe(`${reason}-19`)
          }
        )
      )
    })

    it('getRecentDecisions clamps negative and zero limits to an empty array', () => {
      fc.assert(
        fc.property(
          fc.array(fc.oneof(fc.nat({ max: 100 }), fc.constant(0)), { minLength: 3, maxLength: 10 }),
          bashCallArb,
          denialReasonArb,
          (limits, call, reason) => {
            const state = new SessionState()
            for (let i = 0; i < 10; i++) {
              state.incrementDenial(call, `${reason}-${i}`)
            }
            for (const limit of limits) {
              const decisions = state.getRecentDecisions(limit)
              expect(decisions.length).toBe(limit <= 0 ? 0 : Math.min(limit, 10))
            }
          }
        )
      )
    })
  })
})
