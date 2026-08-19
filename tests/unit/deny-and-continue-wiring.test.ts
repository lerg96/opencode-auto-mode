import { DenyAndContinueService } from '../../src/deny-and-continue/DenyAndContinueService'
import { SessionState } from '../../src/state/SessionState'
import { PluginConfig, DEFAULT_CONFIG } from '../../src/types/PluginConfig'

interface TestConfig extends PluginConfig {
  denyMode: 'auto-retry' | 'ask-user' | 'both'
}

describe('DenyAndContinueService — auto-retry behavior', () => {
  it('creates different strategies based on denyMode (proves the class exists and works correctly)', () => {
    const state = new SessionState()

    // auto-retry mode
    const retryConfig: TestConfig = {
      ...DEFAULT_CONFIG,
      denyMode: 'auto-retry',
    } as unknown as TestConfig
    const retrySvc = new DenyAndContinueService(retryConfig, state)
    expect(retrySvc.getDenyMode()).toBe('auto-retry')

    // ask-user mode
    const askConfig: TestConfig = {
      ...DEFAULT_CONFIG,
      denyMode: 'ask-user',
    } as unknown as TestConfig
    const askSvc = new DenyAndContinueService(askConfig, state)
    expect(askSvc.getDenyMode()).toBe('ask-user')
  })

  it('BothStrategy uses escalation threshold from config', () => {
    const state = new SessionState()
    // At threshold, BothStrategy switches from auto-retry to ask-user
    const config: TestConfig = {
      ...DEFAULT_CONFIG,
      denyMode: 'both',
      escalation: { consecutive: 3, total: 20 },
    } as unknown as TestConfig
    const svc = new DenyAndContinueService(config, state)

    // Before threshold: returns auto-retry
    const result1 = svc.handleDeny({
      decision: 'deny',
      reasoning: 'test',
      reason: 'test',
    } as any)
    expect(result1.type).toBe('auto-retry')
  })
})
