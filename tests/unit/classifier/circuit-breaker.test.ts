import {
  CircuitBreaker,
  CircuitState,
} from '../../../src/classifier/CircuitBreaker'

describe('CircuitBreaker', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('initial state', () => {
    it('should start in closed state', () => {
      const cb = new CircuitBreaker()
      expect(cb.getState()).toBe(CircuitState.CLOSED)
    })

    it('should start with zero failure count', () => {
      const cb = new CircuitBreaker()
      expect(cb.getFailureCount()).toBe(0)
    })
  })

  describe('withCircuitBreaker - successful operations', () => {
    it('should pass through successful operations', async () => {
      const cb = new CircuitBreaker()
      const result = await cb.withCircuitBreaker(async () => {
        return 'success'
      })

      expect(result).toBe('success')
      expect(cb.getState()).toBe(CircuitState.CLOSED)
      expect(cb.getFailureCount()).toBe(0)
    })

    it('should maintain closed state after multiple successes', async () => {
      const cb = new CircuitBreaker()
      for (let i = 0; i < 10; i++) {
        await cb.withCircuitBreaker(async () => {
          return i
        })
      }

      expect(cb.getState()).toBe(CircuitState.CLOSED)
      expect(cb.getFailureCount()).toBe(0)
    })
  })

  describe('withCircuitBreaker - failures', () => {
    it('should increment failure count on error', async () => {
      const cb = new CircuitBreaker(undefined, 30000)
      const testError = new Error('test error')

      await expect(
        cb.withCircuitBreaker(async () => {
          throw testError
        })
      ).rejects.toThrow('test error')

      expect(cb.getFailureCount()).toBe(1)
      expect(cb.getState()).toBe(CircuitState.CLOSED)
    })

    it('should open circuit after reaching failure threshold', async () => {
      const threshold = 3
      const cb = new CircuitBreaker()
      const testError = new Error('fail')

      for (let i = 0; i < threshold; i++) {
        let threw = false
        try {
          await cb.withCircuitBreaker(async () => {
            throw testError
          })
        } catch (e: unknown) {
          threw = true
          if (i < threshold - 1) {
            expect((e as Error).message).toBe('fail')
          } else {
            expect((e as Error).message).toContain('OPEN')
          }
        }
        expect(threw).toBe(true)
      }
      expect(cb.getState()).toBe(CircuitState.OPEN)
    })

    it('should throw when circuit is open and recovery timeout has not elapsed', async () => {
      const cb = new CircuitBreaker(1, 30000)
      await expect(
        cb.withCircuitBreaker(async () => {
          throw new Error('fail')
        })
      ).rejects.toThrow('fail')

      await expect(
        cb.withCircuitBreaker(async () => {
          return 'should not reach'
        })
      ).rejects.toThrow('Circuit breaker is OPEN')
    })

    it('should transition to half-open after recovery timeout', async () => {
      const cb = new CircuitBreaker(1, 100)
      await expect(
        cb.withCircuitBreaker(async () => {
          throw new Error('fail')
        })
      ).rejects.toThrow('fail')

      expect(cb.getState()).toBe(CircuitState.OPEN)

      jest.advanceTimersByTime(150)

      await cb.withCircuitBreaker(async () => {
        return 'recovered'
      })

      expect(cb.getState()).toBe(CircuitState.CLOSED)
    })
  })

  describe('reset', () => {
    it('should reset state to closed with zero failures', async () => {
      const cb = new CircuitBreaker(1, 30000)
      await expect(
        cb.withCircuitBreaker(async () => {
          throw new Error('fail')
        })
      ).rejects.toThrow('fail')

      expect(cb.getState()).toBe(CircuitState.OPEN)
      cb.reset()
      expect(cb.getState()).toBe(CircuitState.CLOSED)
      expect(cb.getFailureCount()).toBe(0)
    })

    it('should clear halfOpenInProgress so withCircuitBreaker can be called again after reset', async () => {
      const cb = new CircuitBreaker(1, 50)

      // Open the circuit via failure
      await expect(
        cb.withCircuitBreaker(async () => {
          throw new Error('fail')
        })
      ).rejects.toThrow('fail')

      expect(cb.getState()).toBe(CircuitState.OPEN)

      // Advance past recovery timeout
      jest.advanceTimersByTime(60)

      // Enter half-open; start a slow operation (simulate recovery in progress)
      const slowOp = cb.withCircuitBreaker(async () => {
        // Simulate extended recovery time
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => resolve(), 500)
          ;(cb as any).__mockSetTimeout = t
        })
        return 'success'
      })

      // Now in HALF_OPEN; concurrent request should be rejected
      await expect(
        cb.withCircuitBreaker(async () => {
          return 'should not reach'
        })
      ).rejects.toThrow('HALF_OPEN')

      // Reset the breaker (as would happen in the corrected code: halfOpenInProgress is cleared)
      cb.reset()
      expect(cb.getState()).toBe(CircuitState.CLOSED)

      // After reset, the circuit should allow new operations (halfOpenInProgress was cleared)
      const result = await cb.withCircuitBreaker(async () => {
        return 'works after reset'
      })
      expect(result).toBe('works after reset')
      expect(cb.getState()).toBe(CircuitState.CLOSED)
    })
  })

  describe('half-open concurrent protection', () => {
    it('should reject subsequent requests when a probe is already in progress in HALF_OPEN', async () => {
      const cb = new CircuitBreaker(1, 50)

      await expect(
        cb.withCircuitBreaker(async () => {
          throw new Error('fail')
        })
      ).rejects.toThrow('fail')

      expect(cb.getState()).toBe(CircuitState.OPEN)

      // Advance past recovery timeout deterministically
      jest.advanceTimersByTime(60)

      // Start first probe (half-open in progress)
      const firstCall = cb.withCircuitBreaker(async () => {
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => resolve(), 500)
          ;(cb as any).__mockSetTimeout = t
        })
        return 'success'
      })

      // Advance just a bit to let any pending timers tick
      jest.advanceTimersByTime(10)

      // Second request should be rejected
      await expect(
        cb.withCircuitBreaker(async () => {
          return 'should not reach'
        })
      ).rejects.toThrow('HALF_OPEN')

      // Complete the first call
      jest.advanceTimersByTime(500)

      const result = await firstCall
      expect(result).toBe('success')
      expect(cb.getState()).toBe(CircuitState.CLOSED)
    })

    it('should reject requests when probe is still in-flight in HALF_OPEN', async () => {
      const cb = new CircuitBreaker(1, 50)

      await expect(
        cb.withCircuitBreaker(async () => {
          throw new Error('fail')
        })
      ).rejects.toThrow('fail')

      expect(cb.getState()).toBe(CircuitState.OPEN)

      jest.advanceTimersByTime(60)

      // First probe: waits 500ms then fails
      const firstCall = cb.withCircuitBreaker(async () => {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 500)
          ;(cb as any).__mockSetTimeout = t
        })
        throw new Error('probe failed')
      })

      // State should be HALF_OPEN and probe in-flight
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN)

      // Second request should be rejected (probe still in-flight, not yet at 500ms)
      await expect(
        cb.withCircuitBreaker(async () => {
          return 'should not reach'
        })
      ).rejects.toThrow('HALF_OPEN')

      // Advance past the setTimeout so the probe fails
      jest.advanceTimersByTime(600)

      // First call should have resulted in OPEN circuit after failure
      await expect(firstCall).rejects.toThrow(/probe failed|OPEN/)
    })

    it('should allow new requests after recovery from CLOSED state', async () => {
      const cb = new CircuitBreaker(1, 50)

      await expect(
        cb.withCircuitBreaker(async () => {
          throw new Error('fail')
        })
      ).rejects.toThrow('fail')

      expect(cb.getState()).toBe(CircuitState.OPEN)

      jest.advanceTimersByTime(60)

      await cb.withCircuitBreaker(async () => {
        return 'recovered'
      })

      expect(cb.getState()).toBe(CircuitState.CLOSED)
      expect(cb.getFailureCount()).toBe(0)

      await expect(
        cb.withCircuitBreaker(async () => {
          return 'still works'
        })
      ).resolves.toBe('still works')
    })
  })
})
