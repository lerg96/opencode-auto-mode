import { CircuitBreaker, CircuitState } from '../../../src/classifier/CircuitBreaker';

describe('CircuitBreaker', () => {
  describe('initial state', () => {
    it('should start in closed state', () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should start with zero failure count', () => {
      const cb = new CircuitBreaker();
      expect(cb.getFailureCount()).toBe(0);
    });
  });

  describe('withCircuitBreaker - successful operations', () => {
    it('should pass through successful operations', async () => {
      const cb = new CircuitBreaker();
      const result = await cb.withCircuitBreaker(async () => {
        return 'success';
      });

      expect(result).toBe('success');
      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.getFailureCount()).toBe(0);
    });

    it('should maintain closed state after multiple successes', async () => {
      const cb = new CircuitBreaker();
      for (let i = 0; i < 10; i++) {
        await cb.withCircuitBreaker(async () => {
          return i;
        });
      }

      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.getFailureCount()).toBe(0);
    });
  });

  describe('withCircuitBreaker - failures', () => {
    it('should increment failure count on error', async () => {
      const cb = new CircuitBreaker(undefined, 30000);
      const testError = new Error('test error');

      await expect(cb.withCircuitBreaker(async () => {
        throw testError;
      })).rejects.toThrow('test error');

      expect(cb.getFailureCount()).toBe(1);
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should open circuit after reaching failure threshold', async () => {
      const threshold = 3;
      const cb = new CircuitBreaker();
      const testError = new Error('fail');

      for (let i = 0; i < threshold; i++) {
        let threw = false;
        try {
          await cb.withCircuitBreaker(async () => {
            throw testError;
          });
        } catch (e: unknown) {
          threw = true;
          if (i < threshold - 1) {
            expect((e as Error).message).toBe('fail');
          } else {
            expect((e as Error).message).toContain('OPEN');
          }
        }
        expect(threw).toBe(true);
      }
      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it('should throw when circuit is open and recovery timeout has not elapsed', async () => {
      const cb = new CircuitBreaker(1, 30000);
      await expect(cb.withCircuitBreaker(async () => {
        throw new Error('fail');
      })).rejects.toThrow('fail');

      await expect(cb.withCircuitBreaker(async () => {
        return 'should not reach';
      })).rejects.toThrow('Circuit breaker is OPEN');
    });

    it('should transition to half-open after recovery timeout', async () => {
      const cb = new CircuitBreaker(1, 100);
      await expect(cb.withCircuitBreaker(async () => {
        throw new Error('fail');
      })).rejects.toThrow('fail');

      expect(cb.getState()).toBe(CircuitState.OPEN);

      await new Promise((resolve) => setTimeout(resolve, 150));

      await cb.withCircuitBreaker(async () => {
        return 'recovered';
      });

      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('reset', () => {
    it('should reset state to closed with zero failures', async () => {
      const cb = new CircuitBreaker(1, 30000);
      await expect(cb.withCircuitBreaker(async () => {
        throw new Error('fail');
      })).rejects.toThrow('fail');

      expect(cb.getState()).toBe(CircuitState.OPEN);
      cb.reset();
      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.getFailureCount()).toBe(0);
    });
  });
});
