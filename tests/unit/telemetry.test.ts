import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  TelemetryLogger,
  sanitizeSnippet,
} from '../../src/telemetry/TelemetryLogger'

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-mode-tel-'))

function writeConfig(config: Record<string, unknown>, dir = TMP_DIR): void {
  fs.writeFileSync(path.join(dir, 'auto-mode.jsonc'), JSON.stringify(config))
}

async function loadPlugin(): Promise<typeof import('../../src/plugin')> {
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
  blockRules: [],
  allowExceptions: [],
  fallback: { onTimeout: 'ask-user', onError: 'ask-user' },
  trustBoundary: { protectedPaths: [], protectedCommands: [] },
}

function telemetryCalls(telPath: string): any[] {
  const calls = (fs.promises.appendFile as unknown as jest.Mock).mock.calls
  return calls
    .filter((c: unknown[]) => c[0] === telPath)
    .map((c: unknown[]) => JSON.parse(c[1] as string))
}

describe('TelemetryLogger', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('writes nothing when disabled', () => {
    const logger = new TelemetryLogger(false, path.join(TMP_DIR, 'x.jsonl'))
    const spy = jest
      .spyOn(fs.promises, 'appendFile')
      .mockResolvedValue(undefined)
    logger.logClassification({
      id: 'c1',
      ts: 't',
      command: 'ls',
      decision: 'allow',
      reason: 'ok',
    })
    expect(spy).not.toHaveBeenCalled()
  })

  it('writes a classification and outcome JSONL line when enabled', () => {
    const file = path.join(TMP_DIR, 'a.jsonl')
    const logger = new TelemetryLogger(true, file)
    const spy = jest
      .spyOn(fs.promises, 'appendFile')
      .mockResolvedValue(undefined)
    logger.logClassification({
      id: 'c1',
      ts: 't',
      command: 'ls',
      decision: 'deny',
      reason: 'bad',
    })
    logger.logOutcome({
      id: 'c1',
      ts: 't2',
      command: 'ls',
      outcome: 'denied',
      reason: 'denied by user',
    })
    expect(spy).toHaveBeenCalledTimes(2)
    const [clsCall, outCall] = (spy as unknown as jest.Mock).mock.calls
    expect(clsCall[0]).toBe(file)
    const cls = JSON.parse(clsCall[1])
    expect(cls).toEqual({
      type: 'classification',
      id: 'c1',
      ts: 't',
      command: 'ls',
      decision: 'deny',
      reason: 'bad',
    })
    const out = JSON.parse(outCall[1])
    expect(out).toEqual({
      type: 'outcome',
      id: 'c1',
      ts: 't2',
      command: 'ls',
      outcome: 'denied',
      reason: 'denied by user',
    })
  })

  it('updateConfig reflects runtime changes', () => {
    const logger = new TelemetryLogger(false, '')
    logger.updateConfig(true, 'file')
    expect(logger.isEnabled()).toBe(true)
  })

  it('sanitizeSnippet redacts secrets and truncates long content', () => {
    expect(sanitizeSnippet('plain text')).toBe('plain text')
    expect(sanitizeSnippet('token=SECRET_abc123 tail')).toBe(
      'token=***REDACTED*** tail'
    )
    const long = 'x'.repeat(2000)
    const out = sanitizeSnippet(long) as string
    expect(out.endsWith('[truncated]')).toBe(true)
    expect(out.length).toBeLessThan(2000)
  })
})

describe('plugin telemetry wiring', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const TEL_PATH = path.join(TMP_DIR, 'telemetry.jsonl')

  it('logs a classification record with the raw LLM decision even under ask-user', async () => {
    writeConfig({
      ...BASE,
      denyMode: 'ask-user',
      telemetry: { enabled: true, path: TEL_PATH },
    } as any)
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: '{"allow":false,"reason":"permanently deletes data"}',
              },
            },
          ],
        }),
    } as any)
    const M = await loadPlugin()
    const hooks: any = await M.opencodeAutoMode({})
    await hooks['tool.execute.before'](
      { tool: 'bash', callID: 'call_1', sessionID: 's1' },
      { args: { command: 'git stash drop' } }
    )
    const recs = telemetryCalls(TEL_PATH)
    const cls = recs.find((r) => r.type === 'classification')
    expect(cls).toBeDefined()
    expect(cls.id).toBe('call_1')
    expect(cls.command).toBe('git stash drop')
    expect(cls.decision).toBe('deny')
    expect(cls.reason).toBe('permanently deletes data')
  })

  it('logs outcome "denied by user" from permission.replied with shared id', async () => {
    writeConfig({
      ...BASE,
      denyMode: 'ask-user',
      telemetry: { enabled: true, path: TEL_PATH },
    } as any)
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () =>
        Promise.resolve({
          choices: [
            { message: { content: '{"allow":false,"reason":"destructive"}' } },
          ],
        }),
    } as any)
    const M = await loadPlugin()
    const hooks: any = await M.opencodeAutoMode({})
    await hooks['tool.execute.before'](
      { tool: 'bash', callID: 'call_2', sessionID: 's1' },
      { args: { command: 'git stash drop' } }
    )
    await hooks.event({
      event: {
        type: 'permission.asked',
        properties: {
          sessionID: 's1',
          id: 'per_1',
          metadata: { command: 'git stash drop' },
          tool: { callID: 'call_2' },
        },
      },
    })
    await hooks.event({
      event: {
        type: 'permission.replied',
        properties: {
          sessionID: 's1',
          permissionID: 'per_1',
          response: 'deny',
        },
      },
    })
    const recs = telemetryCalls(TEL_PATH)
    const cls = recs.find((r) => r.type === 'classification')
    const out = recs.find((r) => r.type === 'outcome')
    expect(cls.id).toBe('call_2')
    expect(out).toBeDefined()
    expect(out.id).toBe('call_2')
    expect(out.outcome).toBe('denied')
    expect(out.reason).toBe('denied by user')
  })

  it('logs both classification(deny) and outcome(approved) when LLM denied but user approved, sharing id', async () => {
    writeConfig({
      ...BASE,
      denyMode: 'ask-user',
      telemetry: { enabled: true, path: TEL_PATH },
    } as any)
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: '{"allow":false,"reason":"permanently discards"}',
              },
            },
          ],
        }),
    } as any)
    const M = await loadPlugin()
    const hooks: any = await M.opencodeAutoMode({})
    await hooks['tool.execute.before'](
      { tool: 'bash', callID: 'call_3', sessionID: 's1' },
      { args: { command: 'git stash drop' } }
    )
    await hooks.event({
      event: {
        type: 'permission.asked',
        properties: {
          sessionID: 's1',
          id: 'per_3',
          metadata: { command: 'git stash drop' },
          tool: { callID: 'call_3' },
        },
      },
    })
    await hooks.event({
      event: {
        type: 'permission.replied',
        properties: {
          sessionID: 's1',
          permissionID: 'per_3',
          response: 'allow',
        },
      },
    })
    const recs = telemetryCalls(TEL_PATH)
    const cls = recs.find((r) => r.type === 'classification')
    const out = recs.find((r) => r.type === 'outcome')
    expect(cls).toBeDefined()
    expect(cls.decision).toBe('deny')
    expect(cls.reason).toBe('permanently discards')
    expect(out).toBeDefined()
    expect(out.outcome).toBe('approved')
    expect(out.reason).toBe('approved by user')
    expect(cls.id).toBe(out.id)
    expect(cls.id).toBe('call_3')
  })

  it('logs nothing when telemetry is disabled', async () => {
    writeConfig({
      ...BASE,
      telemetry: { enabled: false, path: TEL_PATH },
    } as any)
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '{"allow":true,"reason":"ok"}' } }],
        }),
    } as any)
    const M = await loadPlugin()
    const hooks: any = await M.opencodeAutoMode({})
    await hooks['tool.execute.before'](
      { tool: 'bash', callID: 'call_4', sessionID: 's1' },
      { args: { command: 'echo hi' } }
    )
    expect(telemetryCalls(TEL_PATH).length).toBe(0)
  })
})
