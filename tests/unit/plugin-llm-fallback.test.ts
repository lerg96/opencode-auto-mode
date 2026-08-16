import { callLlmWithFallback, LlmCallResult } from '../../src/LlmClient'

describe('LLM Fallback (LlmClient)', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  function mockFetchResponse(
    ok: boolean,
    status: number,
    model: string
  ): Response {
    return {
      ok,
      status,
      statusText: ok ? 'OK' : `HTTP ${status}`,
      json: async () => ({
        choices: [{ message: { content: `response from ${model}` } }],
      }),
    } as Response
  }

  describe('fallback on HTTP errors', () => {
    it('should retry with fallback model on 500 error', async () => {
      const fetchMock = jest.fn()
      fetchMock
        .mockResolvedValueOnce(mockFetchResponse(false, 500, 'primary'))
        .mockResolvedValueOnce(mockFetchResponse(true, 200, 'fallback-model'))

      const result = await callLlmWithFallback({
        baseUrl: 'http://test.local/v1',
        apiKey: 'test-key',
        model: 'primary-model',
        fallbackModel: 'fallback-model',
        prompt: 'test prompt',
        timeoutMs: 5000,
        fetchImpl: fetchMock as any,
      })

      expect(result.content).toBe('response from fallback-model')
      expect(result.usedFallback).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      const firstCall = JSON.parse((fetchMock as any).mock.calls[0][1].body)
      expect(firstCall.model).toBe('primary-model')

      const secondCall = JSON.parse((fetchMock as any).mock.calls[1][1].body)
      expect(secondCall.model).toBe('fallback-model')
    })

    it('should retry with fallback model on 502 error', async () => {
      const fetchMock = jest.fn()
      fetchMock
        .mockResolvedValueOnce(mockFetchResponse(false, 502, 'primary'))
        .mockResolvedValueOnce(mockFetchResponse(true, 200, 'fallback'))

      const result = await callLlmWithFallback({
        baseUrl: 'http://test.local/v1',
        apiKey: 'key',
        model: 'primary',
        fallbackModel: 'fallback',
        prompt: 'prompt',
        timeoutMs: 5000,
        fetchImpl: fetchMock as any,
      })

      expect(result.content).toBe('response from fallback')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('should retry with fallback model on 503 error', async () => {
      const fetchMock = jest.fn()
      fetchMock
        .mockResolvedValueOnce(mockFetchResponse(false, 503, 'primary'))
        .mockResolvedValueOnce(mockFetchResponse(true, 200, 'fallback'))

      const result = await callLlmWithFallback({
        baseUrl: 'http://test.local/v1',
        apiKey: 'key',
        model: 'primary',
        fallbackModel: 'fallback',
        prompt: 'prompt',
        timeoutMs: 5000,
        fetchImpl: fetchMock as any,
      })

      expect(result.content).toBe('response from fallback')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('should retry with fallback model on 504 error', async () => {
      const fetchMock = jest.fn()
      fetchMock
        .mockResolvedValueOnce(mockFetchResponse(false, 504, 'primary'))
        .mockResolvedValueOnce(mockFetchResponse(true, 200, 'fallback'))

      const result = await callLlmWithFallback({
        baseUrl: 'http://test.local/v1',
        apiKey: 'key',
        model: 'primary',
        fallbackModel: 'fallback',
        prompt: 'prompt',
        timeoutMs: 5000,
        fetchImpl: fetchMock as any,
      })

      expect(result.content).toBe('response from fallback')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('should retry with fallback model on 429 rate limit', async () => {
      const fetchMock = jest.fn()
      fetchMock
        .mockResolvedValueOnce(mockFetchResponse(false, 429, 'primary'))
        .mockResolvedValueOnce(mockFetchResponse(true, 200, 'fallback'))

      const result = await callLlmWithFallback({
        baseUrl: 'http://test.local/v1',
        apiKey: 'key',
        model: 'primary',
        fallbackModel: 'fallback',
        prompt: 'prompt',
        timeoutMs: 5000,
        fetchImpl: fetchMock as any,
      })

      expect(result.content).toBe('response from fallback')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('should not retry on 400 error', async () => {
      const fetchMock = jest.fn()
      fetchMock.mockResolvedValueOnce(mockFetchResponse(false, 400, 'primary'))

      await expect(
        callLlmWithFallback({
          baseUrl: 'http://test.local/v1',
          apiKey: 'key',
          model: 'primary',
          fallbackModel: 'fallback',
          prompt: 'prompt',
          timeoutMs: 5000,
          fetchImpl: fetchMock as any,
        })
      ).rejects.toThrow('LLM API error: 400')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should not retry on 401 error', async () => {
      const fetchMock = jest.fn()
      fetchMock.mockResolvedValueOnce(mockFetchResponse(false, 401, 'primary'))

      await expect(
        callLlmWithFallback({
          baseUrl: 'http://test.local/v1',
          apiKey: 'key',
          model: 'primary',
          fallbackModel: 'fallback',
          prompt: 'prompt',
          timeoutMs: 5000,
          fetchImpl: fetchMock as any,
        })
      ).rejects.toThrow('LLM API error: 401')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should return error if fallback also fails on HTTP error', async () => {
      const fetchMock = jest.fn()
      fetchMock
        .mockResolvedValueOnce(mockFetchResponse(false, 500, 'primary'))
        .mockResolvedValueOnce(mockFetchResponse(false, 503, 'fallback'))

      await expect(
        callLlmWithFallback({
          baseUrl: 'http://test.local/v1',
          apiKey: 'key',
          model: 'primary',
          fallbackModel: 'fallback',
          prompt: 'prompt',
          timeoutMs: 5000,
          fetchImpl: fetchMock as any,
        })
      ).rejects.toThrow(
        'LLM API error: 500 HTTP 503 (and fallback also returned 503)'
      )

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('fallback on timeouts', () => {
    it('should retry on AbortError', async () => {
      const fetchMock = jest.fn()
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      fetchMock.mockRejectedValueOnce(abortError)
      fetchMock.mockResolvedValueOnce(mockFetchResponse(true, 200, 'fallback'))

      const result = await callLlmWithFallback({
        baseUrl: 'http://test.local/v1',
        apiKey: 'key',
        model: 'primary',
        fallbackModel: 'fallback',
        prompt: 'prompt',
        timeoutMs: 5000,
        fetchImpl: fetchMock as any,
      })

      expect(result.content).toBe('response from fallback')
      expect(result.usedFallback).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('should retry on network error', async () => {
      const fetchMock = jest.fn()
      fetchMock.mockRejectedValueOnce(new Error('Network error ECONNREFUSED'))
      fetchMock.mockResolvedValueOnce(mockFetchResponse(true, 200, 'fallback'))

      const result = await callLlmWithFallback({
        baseUrl: 'http://test.local/v1',
        apiKey: 'key',
        model: 'primary',
        fallbackModel: 'fallback',
        prompt: 'prompt',
        timeoutMs: 5000,
        fetchImpl: fetchMock as any,
      })

      expect(result.content).toBe('response from fallback')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('no retry when fallback disabled', () => {
    it('should not retry when fallbackModel is empty', async () => {
      const fetchMock = jest.fn()
      fetchMock.mockRejectedValueOnce(new Error('LLM API error: 500 Internal'))

      await expect(
        callLlmWithFallback({
          baseUrl: 'http://test.local/v1',
          apiKey: 'key',
          model: 'primary',
          fallbackModel: '',
          prompt: 'prompt',
          timeoutMs: 5000,
          fetchImpl: fetchMock as any,
        })
      ).rejects.toThrow('LLM API error: 500 Internal')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should not retry on non-retryable error even with fallback', async () => {
      const fetchMock = jest.fn()
      fetchMock.mockRejectedValueOnce(
        new Error('LLM API error: 400 Bad Request')
      )

      await expect(
        callLlmWithFallback({
          baseUrl: 'http://test.local/v1',
          apiKey: 'key',
          model: 'primary',
          fallbackModel: 'fallback',
          prompt: 'prompt',
          timeoutMs: 5000,
          fetchImpl: fetchMock as any,
        })
      ).rejects.toThrow('LLM API error: 400 Bad Request')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('no fallback when primary succeeds', () => {
    it('should return primary result without calling fallback', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(mockFetchResponse(true, 200, 'primary'))

      const result = await callLlmWithFallback({
        baseUrl: 'http://test.local/v1',
        apiKey: 'key',
        model: 'primary',
        fallbackModel: 'fallback',
        prompt: 'prompt',
        timeoutMs: 5000,
        fetchImpl: fetchMock as any,
      })

      expect(result.content).toBe('response from primary')
      expect(result.usedFallback).toBe(false)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should return fallback content when fallback model is used', async () => {
      const fetchMock = jest.fn()
      fetchMock
        .mockResolvedValueOnce(mockFetchResponse(false, 503, 'primary'))
        .mockResolvedValueOnce(mockFetchResponse(true, 200, 'fallback-model'))

      const result = await callLlmWithFallback({
        baseUrl: 'http://test.local/v1',
        apiKey: 'key',
        model: 'primary-model',
        fallbackModel: 'fallback-model',
        prompt: 'test prompt',
        timeoutMs: 5000,
        fetchImpl: fetchMock as any,
      })

      expect(result.content).toBe('response from fallback-model')
      expect(result.usedFallback).toBe(true)

      const secondCall = JSON.parse((fetchMock as any).mock.calls[1][1].body)
      expect(secondCall.model).toBe('fallback-model')
    })
  })

  describe('request payload', () => {
    it('should send correct request body', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(mockFetchResponse(true, 200, 'test'))

      await callLlmWithFallback({
        baseUrl: 'http://custom.local/v1',
        apiKey: 'my-api-key',
        model: 'my-model',
        fallbackModel: 'fb-model',
        prompt: 'my prompt',
        timeoutMs: 8888,
        maxTokens: 9999,
        fetchImpl: fetchMock as any,
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, options] = (fetchMock as any).mock.calls[0]
      expect(url).toBe('http://custom.local/v1/chat/completions')
      expect(options.method).toBe('POST')
      expect(options.headers['Content-Type']).toBe('application/json')
      expect(options.headers['Authorization']).toBe('Bearer my-api-key')

      const body = JSON.parse(options.body)
      expect(body.model).toBe('my-model')
      expect(body.messages).toEqual([{ role: 'user', content: 'my prompt' }])
      expect(body.max_tokens).toBe(9999)
      expect(body.temperature).toBe(0)
      expect(body.stream).toBe(false)
    })
  })

  describe('empty response handling', () => {
    it('should return empty string when no choices in response', async () => {
      const fetchMock = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ choices: [] }),
      } as Response)

      const result = await callLlmWithFallback({
        baseUrl: 'http://test.local/v1',
        apiKey: 'key',
        model: 'primary',
        fallbackModel: 'fallback',
        prompt: 'prompt',
        timeoutMs: 5000,
        fetchImpl: fetchMock as any,
      })

      expect(result.content).toBe('')
    })
  })
})
