import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type PluginModule = typeof import('../../src/plugin')
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-mode-test-'))

function writeConfig(config: Record<string, unknown>, dir = TMP_DIR): void {
  fs.writeFileSync(path.join(dir, 'auto-mode.jsonc'), JSON.stringify(config))
}

async function loadPlugin(): Promise<PluginModule> {
  jest.resetModules()
  process.env.OPENCODE_CONFIG_DIR = TMP_DIR
  jest.spyOn(fs.promises, 'appendFile').mockResolvedValue(undefined)
  return import('../../src/plugin')
}

const BASE = {
  llm: {
    enabled: true,
    provider: 'openai',
    baseUrl: 'http://localhost:9999/v1',
    model: 'test-model',
    fallbackModel: '',
    timeout: 1000,
  },
  blockRules: [
    {
      id: 'BR-CRIT',
      type: 'pattern',
      pattern: 'regex:danger-cmd',
      severity: 'critical',
      description: 'critical dangerous',
      enabled: true,
    },
    {
      id: 'BR-HIGH',
      type: 'pattern',
      pattern: 'regex:warn-cmd',
      severity: 'high',
      description: 'high dangerous',
      enabled: true,
    },
  ],
  allowExceptions: [],
  fallback: { onTimeout: 'ask-user', onError: 'ask-user' },
  trustBoundary: { protectedPaths: [], protectedCommands: [] },
}

describe('denyMode wiring', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('auto-retry (default): critical rule deny carries the deny-and-continue retry message', async () => {
    writeConfig({ ...BASE, denyMode: 'auto-retry' } as any)
    const M = await loadPlugin()
    await M.opencodeAutoMode({})
    const res = await M.classifyCommand('danger-cmd test', 's1')

    expect(res.decision).toBe('deny')
    expect(res.reason).toContain('[BR-CRIT]')
    expect(res.reason).toContain('safer approach')
  })

  it('ask-user: critical rule deny is surfaced as a user question', async () => {
    writeConfig({ ...BASE, denyMode: 'ask-user' } as any)
    const M = await loadPlugin()
    await M.opencodeAutoMode({})
    const res = await M.classifyCommand('danger-cmd test', 's2')

    expect(res.decision).toBe('ask')
    expect(res.reason).toContain('user confirmation required')
  })

  it('both: below escalation threshold the deny auto-retries', async () => {
    writeConfig({ ...BASE, denyMode: 'both' } as any)
    const M = await loadPlugin()
    await M.opencodeAutoMode({})
    const res = await M.classifyCommand('danger-cmd test', 's3')

    expect(res.decision).toBe('deny')
    expect(res.reason).toContain('safer approach')
  })

  it('high severity rules still ask the user regardless of denyMode', async () => {
    writeConfig({ ...BASE, denyMode: 'auto-retry' } as any)
    const M = await loadPlugin()
    await M.opencodeAutoMode({})
    const res = await M.classifyCommand('warn-cmd test', 's4')

    expect(res.decision).toBe('ask')
  })

  it('ask-user: LLM deny is surfaced as a user question, not auto-rejected', async () => {
    writeConfig({ ...BASE, denyMode: 'ask-user' } as any)
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () =>
        Promise.resolve({
          choices: [
            { message: { content: '{"allow":false,"reason":"unsafe"}' } },
          ],
        }),
    } as any)
    const M = await loadPlugin()
    await M.opencodeAutoMode({})
    const res = await M.classifyCommand('random-cmd', 's-llm-ask')

    expect(res.decision).toBe('ask')
    expect(res.reason).toContain('user confirmation required')
  })

  it('auto-retry: LLM deny still carries the deny-and-continue retry message', async () => {
    writeConfig({ ...BASE, denyMode: 'auto-retry' } as any)
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () =>
        Promise.resolve({
          choices: [
            { message: { content: '{"allow":false,"reason":"unsafe"}' } },
          ],
        }),
    } as any)
    const M = await loadPlugin()
    await M.opencodeAutoMode({})
    const res = await M.classifyCommand('random-cmd', 's-llm-retry')

    expect(res.decision).toBe('deny')
    expect(res.reason).toContain('safer approach')
  })

  it('both: LLM deny escalates to ask after the consecutive threshold', async () => {
    writeConfig({ ...BASE, denyMode: 'both' } as any)
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () =>
        Promise.resolve({
          choices: [
            { message: { content: '{"allow":false,"reason":"unsafe"}' } },
          ],
        }),
    } as any)
    const M = await loadPlugin()
    await M.opencodeAutoMode({})
    for (let i = 0; i < 3; i++) M.recordDenied('s-llm-both')
    const res = await M.classifyCommand('random-cmd', 's-llm-both')

    expect(res.decision).toBe('ask')
  })
})

describe('denyMode escalation wiring', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('both: escalates to ask once the consecutive threshold is reached', async () => {
    writeConfig({ ...BASE, denyMode: 'both' } as any)
    const M = await loadPlugin()
    await M.opencodeAutoMode({})
    for (let i = 0; i < 3; i++) M.recordDenied('s-both')
    const res = await M.classifyCommand('danger-cmd test', 's-both')

    expect(res.decision).toBe('ask')
  })

  it('both: honors a custom escalation.consecutive threshold', async () => {
    writeConfig({
      ...BASE,
      denyMode: 'both',
      escalation: { consecutive: 1, total: 20 },
    } as any)
    const M = await loadPlugin()
    await M.opencodeAutoMode({})
    M.recordDenied('s-both-1')
    const res = await M.classifyCommand('danger-cmd test', 's-both-1')

    expect(res.decision).toBe('ask')
  })

  it('auto-retry: critical denials never escalate in the deny-and-continue path', async () => {
    writeConfig({ ...BASE, denyMode: 'auto-retry' } as any)
    const M = await loadPlugin()
    await M.opencodeAutoMode({})
    for (let i = 0; i < 5; i++) M.recordDenied('s-auto')
    const res = await M.classifyCommand('danger-cmd test', 's-auto')

    expect(res.decision).toBe('deny')
    expect(res.reason).toContain('safer approach')
  })

  it('session.created resets the per-session escalation counters', async () => {
    writeConfig({ ...BASE, denyMode: 'both' } as any)
    const M = await loadPlugin()
    const hooks: any = await M.opencodeAutoMode({})
    for (let i = 0; i < 3; i++) M.recordDenied('s-reset')
    expect(M.getDenialState('s-reset')).toEqual({ consecutive: 3, total: 3 })
    await hooks.event({
      event: {
        type: 'session.created',
        properties: { info: { id: 's-reset', agent: 'general' } },
      },
    })
    expect(M.getDenialState('s-reset')).toEqual({ consecutive: 0, total: 0 })
  })

  it('escalation counters do not leak into a new session', async () => {
    writeConfig({ ...BASE, denyMode: 'both' } as any)
    const M = await loadPlugin()
    await M.opencodeAutoMode({})
    for (let i = 0; i < 3; i++) M.recordDenied('s-leak')
    const res = await M.classifyCommand('danger-cmd test', 's-fresh')

    expect(res.decision).toBe('deny')
    expect(res.reason).toContain('safer approach')
  })
})
