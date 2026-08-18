import { RetryHandler } from '../../../src/classifier/RetryHandler'

describe('RetryHandler', () => {
  describe('constructor defaults', () => {
    it('should have default max retries of 2', () => {
      const rh = new RetryHandler()
      expect(rh.getMaxRetries()).toBe(2)
    })

    it('should have default base delay of 1000ms', () => {
      const rh = new RetryHandler()
      expect(rh.getBaseDelay()).toBe(1000)
    })
  })

  describe('executeWithRetry - successful operation', () => {
    it('should return result on first attempt', async () => {
      const rh = new RetryHandler(3, 0)
      const result = await rh.executeWithRetry(async () => {
        return 'success'
      })

      expect(result).toBe('success')
    })
  })

  describe('executeWithRetry - retries on retryable errors', () => {
    it('should retry on timeout errors', async () => {
      const rh = new RetryHandler(2, 0)
      let attempts = 0

      await expect(
        rh.executeWithRetry(async () => {
          attempts++
          if (attempts < 2) {
            throw new Error('Request timeout')
          }
          return 'success'
        })
      ).resolves.toBe('success')

      expect(attempts).toBe(2)
    })

    it('should retry on network errors', async () => {
      const rh = new RetryHandler(2, 0)
      let attempts = 0

      await expect(
        rh.executeWithRetry(async () => {
          attempts++
          if (attempts < 2) {
            throw new Error('Network error ECONNREFUSED')
          }
          return 'success'
        })
      ).resolves.toBe('success')

      expect(attempts).toBe(2)
    })

    it('should retry on abort errors', async () => {
      const rh = new RetryHandler(2, 0)
      let attempts = 0

      await expect(
        rh.executeWithRetry(async () => {
          attempts++
          if (attempts < 2) {
            throw new Error('Abort')
          }
          return 'success'
        })
      ).resolves.toBe('success')

      expect(attempts).toBe(2)
    })
  })

  describe('executeWithRetry - non-retryable errors', () => {
    it('should not retry on non-retryable errors', async () => {
      const rh = new RetryHandler(2, 0)
      let attempts = 0

      await expect(
        rh.executeWithRetry(async () => {
          attempts++
          throw new Error('Something went wrong')
        })
      ).rejects.toThrow('Something went wrong')

      expect(attempts).toBe(1)
    })

    it('should allow custom isRetryable function to override default', async () => {
      const rh = new RetryHandler(2, 0)
      let attempts = 0

      await expect(
        rh.executeWithRetry(
          async () => {
            attempts++
            throw new Error('Custom error')
          },
          () => true
        )
      ).rejects.toThrow('Custom error')

      expect(attempts).toBe(2)
    })
  })

  describe('executeWithRetry - exhausts retries', () => {
    it('should throw last error after exhausting all retries', async () => {
      const rh = new RetryHandler(2, 0)
      const testError = new Error('Persistent error')

      await expect(
        rh.executeWithRetry(
          async () => {
            throw testError
          },
          () => true
        )
      ).rejects.toBe(testError)
    })
  })

  describe('calculateBackoffDelay', () => {
    it('should calculate linear backoff with exponential factor', () => {
      const rh = new RetryHandler(2, 1000)
      expect(rh.calculateBackoffDelay(0)).toBe(1000)
      expect(rh.calculateBackoffDelay(1)).toBe(2000)
      expect(rh.calculateBackoffDelay(2)).toBe(4000)
      expect(rh.calculateBackoffDelay(3)).toBe(8000)
    })
  })

  describe('custom constructor values', () => {
    it('should use custom max retries', () => {
      const rh = new RetryHandler(5)
      expect(rh.getMaxRetries()).toBe(5)
    })

    it('should use custom base delay', () => {
      const rh = new RetryHandler(undefined, 500)
      expect(rh.getBaseDelay()).toBe(500)
    })
  })
})
