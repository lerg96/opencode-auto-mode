export class TimeoutManager {
  private readonly stage1Timeout: number;
  private readonly stage2Timeout: number;

  constructor(stage1TimeoutMs?: number, stage2TimeoutMs?: number) {
    this.stage1Timeout = stage1TimeoutMs || 500;
    this.stage2Timeout = stage2TimeoutMs || 5000;
  }

  createStage1AbortController(): AbortController {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), this.stage1Timeout);
    return controller;
  }

  createStage2AbortController(): AbortController {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), this.stage2Timeout);
    return controller;
  }

  isTimeoutError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.name === 'AbortError' || error.message.includes('timeout') || error.message.includes('AbortError');
    }
    return false;
  }

  getStage1Timeout(): number {
    return this.stage1Timeout;
  }

  getStage2Timeout(): number {
    return this.stage2Timeout;
  }
}
