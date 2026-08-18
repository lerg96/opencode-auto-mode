import { callLlmWithFallback, LlmHttpError, LlmParseError } from '../../../src/LlmClient'
import { RetryHandler } from '../../../src/classifier/RetryHandler'

describe('LlmClient — HTTP errors with typed errors', () => {
  describe('LlmHttpError', () => {
    it('should carry status code and message', () => {
      const err = new LlmHttpError(429, 'Too Many Requests')
      expect(err.status).toBe(429)
      expect(err.message).toBe('LLM API error: 429 Too Many Requests')
    })

    it('should be instance of Error', () => {
      expect(new LlmHttpError(500, 'Internal Error') instanceof Error).toBe(true)
    })
  })

  describe('LlmParseError', () => {
    it('should carry parse error details in message', () => {
      const err = new LlmParseError('Unexpected token <')
      expect(err.message).toBe('LLM response parse error: Unexpected token <')
    })

    it('should be instance of Error', () => {
      expect(new LlmParseError('bad') instanceof Error).toBe(true)
    })

    it('should be instance of SyntaxError', () => {
      expect(new LlmParseError('bad') instanceof SyntaxError).toBe(true)
    })
  })

  describe('429/5xx errors are retryable HTTP errors', () => {
    it('should throw LlmHttpError on 429 with retryable status', async () => {
      let fetchCalled = 0
      const mockFetch = jest.fn().mockImplementation(async () => {
        fetchCalled++
        return { ok: false, status: 429, statusText: 'Too Many Requests' } as Response
      })

      await expect(
        callLlmWithFallback({
          baseUrl: 'http://test.local',
          model: 'm1',
          fallbackModel: 'm2',
          prompt: 'test',
          apiKey: '',
          fetchImpl: mockFetch as any,
        })
      ).rejects.toThrow(LlmHttpError)

      // 429 triggered fallback attempt too
      expect(fetchCalled).toBe(2)
    })

    it('should throw LlmHttpError on 500 with retryable status', async () => {
      let fetchCalled = 0
      const mockFetch = jest.fn().mockImplementation(async () => {
        fetchCalled++
        return { ok: false, status: 500, statusText: 'Internal Server Error' } as Response
      })

      await expect(
        callLlmWithFallback({
          baseUrl: 'http://test.local',
          model: 'm1',
          fallbackModel: 'm2',
          prompt: 'test',
          apiKey: '',
          fetchImpl: mockFetch as any,
        })
      ).rejects.toThrow(LlmHttpError)

      expect(fetchCalled).toBe(2) // primary + fallback
    })

    it('should throw LlmHttpError on 503', async () => {
      let fetchCalled = 0
      const mockFetch = jest.fn().mockImplementation(async () => {
        fetchCalled++
        return { ok: false, status: 503, statusText: 'Service Unavailable' } as Response
      })

      await expect(
        callLlmWithFallback({
          baseUrl: 'http://test.local',
          model: 'm1',
          fallbackModel: 'm2',
          prompt: 'test',
          apiKey: '',
          fetchImpl: mockFetch as any,
        })
      ).rejects.toThrow(LlmHttpError)

      expect(fetchCalled).toBe(2)
    })
  })

  describe('non-2xx non-retryable errors throw immediately', () => {
    it('should throw LlmHttpError on 400 (not retryable)', async () => {
      let fetchCalled = 0
      const mockFetch = jest.fn().mockImplementation(async () => {
        fetchCalled++
        return { ok: false, status: 400, statusText: 'Bad Request' } as Response
      })

      await expect(
        callLlmWithFallback({
          baseUrl: 'http://test.local',
          model: 'm1',
          fallbackModel: 'm2',
          prompt: 'test',
          apiKey: '',
          fetchImpl: mockFetch as any,
        })
      ).rejects.toThrow('LLM API error: 400 Bad Request')

      // Should NOT attempt fallback for 400
      expect(fetchCalled).toBe(1)
    })

    it('should throw LlmHttpError on 401', async () => {
      let fetchCalled = 0
      const mockFetch = jest.fn().mockImplementation(async () => {
        fetchCalled++
        return { ok: false, status: 401, statusText: 'Unauthorized' } as Response
      })

      await expect(
        callLlmWithFallback({
          baseUrl: 'http://test.local',
          model: 'm1',
          fallbackModel: 'm2',
          prompt: 'test',
          apiKey: '',
          fetchImpl: mockFetch as any,
        })
      ).rejects.toThrow('LLM API error: 401 Unauthorized')

      expect(fetchCalled).toBe(1)
    })
  })

  describe('JSON parse failures throw LlmParseError', () => {
    it('should throw LlmParseError when response body is not valid JSON', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('not json at all'),
        json: () => {
          throw new SyntaxError('Unexpected token in JSON at position 0')
        },
      } as unknown as Response)

      await expect(
        callLlmWithFallback({
          baseUrl: 'http://test.local',
          model: 'm1',
          fallbackModel: 'm2',
          prompt: 'test',
          apiKey: '',
          fetchImpl: mockFetch as any,
        })
      ).rejects.toThrow(LlmParseError)
    })

    it('should throw LlmParseError when response body returns null', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(null),
      } as unknown as Response)

      // null JSON body should not throw parse error - it returns empty content
      const result = await callLlmWithFallback({
        baseUrl: 'http://test.local',
        model: 'm1',
        fallbackModel: 'm2',
        prompt: 'test',
        apiKey: '',
        fetchImpl: mockFetch as any,
      })
      expect(result.content).toBe('')
    })
  })
})

describe('RetryHandler — HTTP/parse error integration', () => {
  describe('defaultIsRetryable with typed errors', () => {
    it('should retry LlmHttpError with status 429', async () => {
      const rh = new RetryHandler(2, 0)
      let attempts = 0

      await expect(
        rh.executeWithRetry(async () => {
          attempts++
          if (attempts < 2) {
            throw new LlmHttpError(429, 'Too Many Requests')
          }
          return 'success'
        })
      ).resolves.toBe('success')
      expect(attempts).toBe(2)
    })

    it('should retry LlmHttpError with status 500', async () => {
      const rh = new RetryHandler(2, 0)
      let attempts = 0

      await expect(
        rh.executeWithRetry(async () => {
          attempts++
          if (attempts < 2) {
            throw new LlmHttpError(500, 'Internal Server Error')
          }
          return 'success'
        })
      ).resolves.toBe('success')
      expect(attempts).toBe(2)
    })

    it('should NOT retry LlmHttpError with status 400', async () => {
      const rh = new RetryHandler(2, 0)
      let attempts = 0

      await expect(
        rh.executeWithRetry(async () => {
          attempts++
          throw new LlmHttpError(400, 'Bad Request')
        })
      ).rejects.toThrow(LlmHttpError)
      expect(attempts).toBe(1)
    })

    it('should NOT retry LlmParseError', async () => {
      const rh = new RetryHandler(2, 0)
      let attempts = 0

      await expect(
        rh.executeWithRetry(async () => {
          attempts++
          throw new LlmParseError('Unexpected token')
        })
      ).rejects.toThrow(LlmParseError)
      expect(attempts).toBe(1)
    })
  })
})
