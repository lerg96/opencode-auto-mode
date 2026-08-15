import { FallbackExecutor } from '../../../src/classifier/FallbackExecutor';
import { DEFAULT_CONFIG } from '../../../src/types/PluginConfig';

function createConfig(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    fallback: { onTimeout: 'ask-user', onError: 'ask-user' },
    ...overrides,
  };
}

describe('FallbackExecutor', () => {
  describe('executeOnTimeout', () => {
    it('should allow on timeout when fallback is allow', () => {
      const config = { ...DEFAULT_CONFIG, fallback: { onTimeout: 'allow', onError: 'deny' } };
      const executor = new FallbackExecutor(config as any);
      const error = new Error('timeout occurred');
      const result = executor.executeOnTimeout(error);

      expect(result.decision).toBe('allow');
      expect(result.reasoning).toContain('timeout');
      expect(result.stage).toBe(1);
    });

    it('should deny on timeout when fallback is deny', () => {
      const config = { ...DEFAULT_CONFIG, fallback: { onTimeout: 'deny', onError: 'allow' } };
      const executor = new FallbackExecutor(config as any);
      const error = new Error('timeout occurred');
      const result = executor.executeOnTimeout(error);

      expect(result.decision).toBe('deny');
      expect(result.reasoning).toContain('timeout');
      expect(result.stage).toBe(1);
    });

    it('should escalate on timeout when fallback is ask-user', () => {
      const config = { ...DEFAULT_CONFIG, fallback: { onTimeout: 'ask-user', onError: 'deny' } };
      const executor = new FallbackExecutor(config as any);
      const error = new Error('timeout occurred');
      const result = executor.executeOnTimeout(error);

      expect(result.decision).toBe('escalate');
      expect(result.reasoning).toContain('timeout');
    });
  });

  describe('executeOnError', () => {
    it('should allow on error when fallback is allow', () => {
      const config = { ...DEFAULT_CONFIG, fallback: { onTimeout: 'deny', onError: 'allow' } };
      const executor = new FallbackExecutor(config as any);
      const error = new Error('API error');
      const result = executor.executeOnError(error);

      expect(result.decision).toBe('allow');
      expect(result.reasoning).toContain('API error');
    });

    it('should deny on error when fallback is deny', () => {
      const config = { ...DEFAULT_CONFIG, fallback: { onTimeout: 'allow', onError: 'deny' } };
      const executor = new FallbackExecutor(config as any);
      const error = new Error('API error');
      const result = executor.executeOnError(error);

      expect(result.decision).toBe('deny');
      expect(result.reasoning).toContain('API error');
    });

    it('should escalate on error when fallback is ask-user (default)', () => {
      const config = { ...DEFAULT_CONFIG, fallback: { onTimeout: 'deny', onError: 'ask-user' } };
      const executor = new FallbackExecutor(config as any);
      const error = new Error('API error');
      const result = executor.executeOnError(error);

      expect(result.decision).toBe('escalate');
    });
  });

  describe('executeOnMalformedResponse', () => {
    it('should always deny for malformed responses (hardcoded)', () => {
      const config = { ...DEFAULT_CONFIG, fallback: { onTimeout: 'allow', onError: 'allow' } };
      const executor = new FallbackExecutor(config as any);
      const error = new Error('Malformed JSON');
      const result = executor.executeOnMalformedResponse(error);

      expect(result.decision).toBe('deny');
      expect(result.reasoning).toContain('Malformed LLM response');
    });
  });

  describe('isTimeoutError', () => {
    it('should detect timeout errors', () => {
      const executor = new FallbackExecutor(DEFAULT_CONFIG as any);
      expect(executor.isTimeoutError(new Error('timeout'))).toBe(true);
    });

    it('should not detect non-timeout errors', () => {
      const executor = new FallbackExecutor(DEFAULT_CONFIG as any);
      expect(executor.isTimeoutError(new Error('API error'))).toBe(false);
    });
  });

  describe('determineFallbackAction', () => {
    it('should return onTimeout action for timeout errors', () => {
      const config = { ...DEFAULT_CONFIG, fallback: { onTimeout: 'allow', onError: 'deny' } };
      const executor = new FallbackExecutor(config as any);
      const action = executor.determineFallbackAction(new Error('timeout'));
      expect(action).toBe('allow');
    });

    it('should return onError action for non-timeout errors', () => {
      const config = { ...DEFAULT_CONFIG, fallback: { onTimeout: 'allow', onError: 'deny' } };
      const executor = new FallbackExecutor(config as any);
      const action = executor.determineFallbackAction(new Error('API error'));
      expect(action).toBe('deny');
    });
  });
});
