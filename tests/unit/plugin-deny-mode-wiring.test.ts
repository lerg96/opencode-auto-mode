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
})
