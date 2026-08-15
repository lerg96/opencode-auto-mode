import { TimeoutManager } from '../../../src/classifier/TimeoutManager';

describe('TimeoutManager', () => {
  describe('constructor defaults', () => {
    it('should have default stage 1 timeout of 500ms', () => {
      const tm = new TimeoutManager();
      expect(tm.getStage1Timeout()).toBe(500);
    });

    it('should have default stage 2 timeout of 5000ms', () => {
      const tm = new TimeoutManager();
      expect(tm.getStage2Timeout()).toBe(5000);
    });
  });

  describe('custom timeouts', () => {
    it('should use custom stage 1 timeout', () => {
      const tm = new TimeoutManager(1000);
      expect(tm.getStage1Timeout()).toBe(1000);
    });

    it('should use custom stage 2 timeout', () => {
      const tm = new TimeoutManager(undefined, 10000);
      expect(tm.getStage2Timeout()).toBe(10000);
    });

    it('should use both custom timeouts', () => {
      const tm = new TimeoutManager(1000, 10000);
      expect(tm.getStage1Timeout()).toBe(1000);
      expect(tm.getStage2Timeout()).toBe(10000);
    });
  });

  describe('createStage1AbortController', () => {
    it('should return an AbortController', () => {
      const tm = new TimeoutManager(10);
      const controller = tm.createStage1AbortController();
      expect(controller).toBeDefined();
      expect(controller.signal).toBeDefined();
    });

    it('should abort after the configured timeout', async () => {
      const tm = new TimeoutManager(10);
      const controller = tm.createStage1AbortController();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe('createStage2AbortController', () => {
    it('should return an AbortController', () => {
      const tm = new TimeoutManager(undefined, 10);
      const controller = tm.createStage2AbortController();
      expect(controller).toBeDefined();
      expect(controller.signal).toBeDefined();
    });

    it('should abort after the configured timeout', async () => {
      const tm = new TimeoutManager(undefined, 10);
      const controller = tm.createStage2AbortController();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe('isTimeoutError', () => {
    it('should detect AbortError by name', () => {
      const tm = new TimeoutManager();
      const error = new Error('The operation was aborted.');
      (error as any).name = 'AbortError';
      expect(tm.isTimeoutError(error)).toBe(true);
    });

    it('should detect error with timeout in message', () => {
      const tm = new TimeoutManager();
      const error = new Error('Request timeout');
      expect(tm.isTimeoutError(error)).toBe(true);
    });

    it('should detect error with AbortError in message', () => {
      const tm = new TimeoutManager();
      const error = new Error('Failed: AbortError occurred');
      expect(tm.isTimeoutError(error)).toBe(true);
    });

    it('should return false for regular errors', () => {
      const tm = new TimeoutManager();
      const error = new Error('Something else went wrong');
      expect(tm.isTimeoutError(error)).toBe(false);
    });

    it('should return false for non-Error values', () => {
      const tm = new TimeoutManager();
      expect(tm.isTimeoutError('string error')).toBe(false);
      expect(tm.isTimeoutError(null)).toBe(false);
      expect(tm.isTimeoutError(undefined)).toBe(false);
      expect(tm.isTimeoutError(123)).toBe(false);
    });
  });
});
