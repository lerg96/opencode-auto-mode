import { LLMProviderAbstraction } from '../../../src/classifier/LLMProviderAbstraction';
import { CircuitState } from '../../../src/classifier/CircuitBreaker';
import { DEFAULT_CONFIG } from '../../../src/types/PluginConfig';

describe('LLMProviderAbstraction', () => {
  const mockConfig = {
    ...DEFAULT_CONFIG,
    llm: {
      ...DEFAULT_CONFIG.llm,
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-20250514',
      timeout: 5000,
    },
  };

  describe('constructor', () => {
    it('should create instance with default circuit breaker in closed state', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key');
      expect(provider.getCircuitBreaker().getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('classifyStage1', () => {
    it('should throw when circuit breaker is open', async () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key');
      const cb = provider.getCircuitBreaker();
      const breaker = cb as unknown as { failureCount: number; state: CircuitState };
      breaker.failureCount = 5;
      breaker.state = CircuitState.OPEN;

      await expect(provider.classifyStage1('test prompt')).rejects.toThrow();
    });
  });

  describe('classifyStage2', () => {
    it('should throw when circuit breaker is open', async () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key');
      const cb = provider.getCircuitBreaker();
      const breaker = cb as unknown as { failureCount: number; state: CircuitState };
      breaker.failureCount = 5;
      breaker.state = CircuitState.OPEN;

      await expect(provider.classifyStage2('test prompt')).rejects.toThrow();
    });
  });

  describe('parseAnthropicResponse', () => {
    it('should parse stage 1 allow response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key');
      const mockData = {
        content: [{ text: 'ALLOW' }],
      };

      const result = (provider as any).parseAnthropicResponse(mockData, 'stage1');
      expect((result as any).prediction).toBe('allow');
    });

    it('should parse stage 1 block response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key');
      const mockData = {
        content: [{ text: 'BLOCK' }],
      };

      const result = (provider as any).parseAnthropicResponse(mockData, 'stage1');
      expect((result as any).prediction).toBe('block');
    });

    it('should parse stage 2 allow response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key');
      const mockData = {
        content: [{ text: 'The action is safe. ALLOW' }],
      };

      const result = (provider as any).parseAnthropicResponse(mockData, 'stage2');
      expect((result as any).decision).toBe('allow');
    });

    it('should parse stage 2 deny response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key');
      const mockData = {
        content: [{ text: 'The action is dangerous. DENY' }],
      };

      const result = (provider as any).parseAnthropicResponse(mockData, 'stage2');
      expect((result as any).decision).toBe('deny');
    });

    it('should throw for malformed response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key');

      expect(() => (provider as any).parseAnthropicResponse({}, 'stage1')).toThrow('Malformed Anthropic response');
    });
  });

  describe('parseOpenAIResponse', () => {
    it('should parse stage 1 allow response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key');
      const mockData = {
        choices: [{ message: { content: 'ALLOW' } }],
      };

      const result = (provider as any).parseOpenAIResponse(mockData, 'stage1');
      expect((result as any).prediction).toBe('allow');
    });

    it('should parse stage 2 deny response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key');
      const mockData = {
        choices: [{ message: { content: 'The action is dangerous. DENY' } }],
      };

      const result = (provider as any).parseOpenAIResponse(mockData, 'stage2');
      expect((result as any).decision).toBe('deny');
    });

    it('should throw for malformed response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key');

      expect(() => (provider as any).parseOpenAIResponse({}, 'stage1')).toThrow('Malformed OpenAI response');
    });
  });
});
