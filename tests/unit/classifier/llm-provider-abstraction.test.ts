import { LLMProviderAbstraction } from '../../../src/classifier/LLMProviderAbstraction'
import { CircuitState } from '../../../src/classifier/CircuitBreaker'
import { DEFAULT_CONFIG } from '../../../src/types/PluginConfig'

describe('LLMProviderAbstraction', () => {
  const mockConfig = {
    ...DEFAULT_CONFIG,
    llm: {
      ...DEFAULT_CONFIG.llm,
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-20250514',
      timeout: 5000,
    },
  }

  describe('constructor', () => {
    it('should create instance with default circuit breaker in closed state', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')
      expect(provider.getCircuitBreaker().getState()).toBe(CircuitState.CLOSED)
    })
  })

  describe('classifyStage1', () => {
    it('should throw when circuit breaker is open', async () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')
      const cb = provider.getCircuitBreaker()
      const breaker = cb as unknown as {
        failureCount: number
        state: CircuitState
      }
      breaker.failureCount = 5
      breaker.state = CircuitState.OPEN

      await expect(provider.classifyStage1('test prompt')).rejects.toThrow()
    })
  })

  describe('classifyStage2', () => {
    it('should throw when circuit breaker is open', async () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')
      const cb = provider.getCircuitBreaker()
      const breaker = cb as unknown as {
        failureCount: number
        state: CircuitState
      }
      breaker.failureCount = 5
      breaker.state = CircuitState.OPEN

      await expect(provider.classifyStage2('test prompt')).rejects.toThrow()
    })
  })

  describe('parseAnthropicResponse', () => {
    it('should parse stage 1 allow response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')
      const mockData = {
        content: [{ text: 'ALLOW' }],
      }

      const result = (provider as any).parseAnthropicResponse(
        mockData,
        'stage1'
      )
      expect((result as any).prediction).toBe('allow')
    })

    it('should parse stage 1 block response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')
      const mockData = {
        content: [{ text: 'BLOCK' }],
      }

      const result = (provider as any).parseAnthropicResponse(
        mockData,
        'stage1'
      )
      expect((result as any).prediction).toBe('block')
    })

    it('should parse stage 2 allow response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')
      const mockData = {
        content: [{ text: 'The action is safe. ALLOW' }],
      }

      const result = (provider as any).parseAnthropicResponse(
        mockData,
        'stage2'
      )
      expect((result as any).decision).toBe('allow')
    })

    it('should parse stage 2 deny response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')
      const mockData = {
        content: [{ text: 'The action is dangerous. DENY' }],
      }

      const result = (provider as any).parseAnthropicResponse(
        mockData,
        'stage2'
      )
      expect((result as any).decision).toBe('deny')
    })

    it('should throw for malformed response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')

      expect(() =>
        (provider as any).parseAnthropicResponse({}, 'stage1')
      ).toThrow('Malformed Anthropic response')
    })
  })

  describe('parseOpenAIResponse', () => {
    it('should parse stage 1 allow response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')
      const mockData = {
        choices: [{ message: { content: 'ALLOW' } }],
      }

      const result = (provider as any).parseOpenAIResponse(mockData, 'stage1')
      expect((result as any).prediction).toBe('allow')
    })

    it('should parse stage 2 deny response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')
      const mockData = {
        choices: [{ message: { content: 'The action is dangerous. DENY' } }],
      }

      const result = (provider as any).parseOpenAIResponse(mockData, 'stage2')
      expect((result as any).decision).toBe('deny')
    })

    it('should throw for malformed response', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')

      expect(() => (provider as any).parseOpenAIResponse({}, 'stage1')).toThrow(
        'Malformed OpenAI response'
      )
    })
  })

  describe('callLocal - endpoint verification', () => {
    it('should call the local Ollama endpoint for local provider', async () => {
      const localConfig = {
        ...mockConfig,
        llm: {
          ...mockConfig.llm,
          provider: 'local' as const,
          model: 'qwen3.5-9b',
          timeout: 5000,
          baseUrl: 'http://localhost:18780/v1',
        },
      }
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'ALLOW\nThe command is safe.' } }],
          }),
      } as any)

      try {
        const provider = new LLMProviderAbstraction(localConfig, 'local-key')
        const result = await provider.classifyStage2('classify this')

        expect(fetchSpy).toHaveBeenCalledWith(
          'http://localhost:18780/v1/chat/completions',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer local-key',
            },
            body: expect.stringContaining('qwen3.5-9b'),
          })
        )
        expect((result as any).decision).toBe('allow')
      } finally {
        fetchSpy.mockRestore()
      }
    })
  })

  describe('latency population from startTime', () => {
    it('should populate latency in parseAnthropicResponse', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')

      // Call parseAnthropicResponse directly and verify latency is 0
      const result = (provider as any).parseAnthropicResponse(
        { content: [{ text: 'ALLOW' }] },
        'stage1'
      )
      expect((result as any).latency).toBeDefined()
      expect(typeof (result as any).latency).toBe('number')
    })

    it('should populate latency in parseOpenAIResponse', () => {
      const provider = new LLMProviderAbstraction(mockConfig, 'test-api-key')

      const result = (provider as any).parseOpenAIResponse(
        { choices: [{ message: { content: 'DENY' } }] },
        'stage2'
      )
      expect((result as any).latency).toBeDefined()
      expect(typeof (result as any).latency).toBe('number')
    })
  })
})
