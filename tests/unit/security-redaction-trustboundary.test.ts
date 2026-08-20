import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { RuleEvaluator } from '../../src/rules/RuleEvaluator'
import { PatternMatcher } from '../../src/rules/PatternMatcher'
import type { ToolCall } from '../../src/types/ToolCall'
import { DEFAULT_TRUST_BOUNDARY } from '../../src/types/PluginConfig'

type PluginModule = typeof import('../../src/plugin')

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sec-review-'))

function writeConfig(config: Record<string, unknown>, dir = TMP_DIR): void {
  fs.writeFileSync(path.join(dir, 'auto-mode.jsonc'), JSON.stringify(config))
}

async function loadPlugin(): Promise<PluginModule> {
  jest.resetModules()
  process.env.OPENCODE_CONFIG_DIR = TMP_DIR
  jest.spyOn(fs.promises, 'appendFile').mockResolvedValue(undefined)
  return import('../../src/plugin')
}

function tc(cmd: string): ToolCall {
  return {
    toolName: 'Bash',
    arguments: { command: cmd },
    context: { agentName: 't', workingDirectory: '', sessionId: 's' },
  }
}

describe('CRITICAL: secret guard flags underscore-prefixed credential names', () => {
  beforeAll(() => {
    writeConfig({
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
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('flags *_TOKEN / *_SECRET / *_API_KEY / *_PASSWORD assignments', async () => {
    const M = await loadPlugin()
    expect(M.isSecretSensitive('export GITHUB_TOKEN=ghp_1234567890abcdef')).toBe(true)
    expect(M.isSecretSensitive('export NPM_TOKEN=npm_abc123')).toBe(true)
    expect(M.isSecretSensitive('MY_SECRET=hunter2')).toBe(true)
    expect(M.isSecretSensitive('STRIPE_API_KEY=sk_live_123')).toBe(true)
    expect(M.isSecretSensitive('DATABASE_PASSWORD=p@ss')).toBe(true)
    expect(M.isSecretSensitive('CLIENT_SECRET=abc')).toBe(true)
  })

  it('flags JSON-quoted credential assignments in a command', async () => {
    const M = await loadPlugin()
    expect(M.isSecretSensitive('curl -d \'{"password":"hunter2"}\' http://x')).toBe(true)
    expect(M.isSecretSensitive('curl -d \'{"api_key":"sk-abc"}\' http://x')).toBe(true)
  })

  it('flags connection-string credentials with non-http schemes', async () => {
    const M = await loadPlugin()
    expect(
      M.isSecretSensitive('psql "postgres://appuser:s3cr3t@db:5432/app"')
    ).toBe(true)
    expect(
      M.isSecretSensitive('mongo "mongodb://root:toor@mongo:27017/admin"')
    ).toBe(true)
  })

  it('does not flag benign commands', async () => {
    const M = await loadPlugin()
    expect(M.isSecretSensitive('git status')).toBe(false)
    expect(M.isSecretSensitive('npm run build')).toBe(false)
    expect(M.isSecretSensitive('ls -la /tmp')).toBe(false)
  })
})

describe('CRITICAL: trust boundary is case-insensitive (win32 / case variants)', () => {
  const ev = new RuleEvaluator(new PatternMatcher())

  it('blocks case-variant protected paths on a case-insensitive FS', () => {
    expect(ev.evaluate(tc('type C:\\WINDOWS\\system32\\config\\SAM'), [], [], DEFAULT_TRUST_BOUNDARY).evaluation).toBe('blocked')
    expect(ev.evaluate(tc('cat ~/.SSH/id_rsa'), [], [], DEFAULT_TRUST_BOUNDARY).evaluation).toBe('blocked')
    expect(ev.evaluate(tc('cat /ETC/passwd'), [], [], DEFAULT_TRUST_BOUNDARY).evaluation).toBe('blocked')
  })

  it('still blocks exact-case protected paths', () => {
    expect(ev.evaluate(tc('cat /etc/passwd'), [], [], DEFAULT_TRUST_BOUNDARY).evaluation).toBe('blocked')
    expect(ev.evaluate(tc('type C:\\Windows\\system32\\config\\SAM'), [], [], DEFAULT_TRUST_BOUNDARY).evaluation).toBe('blocked')
  })

  it('does not over-block benign sibling paths', () => {
    const r = ev.evaluate(
      tc('cat /etc-backup/notes.txt'),
      [],
      [],
      { protectedPaths: ['/etc/'], protectedCommands: [] }
    )
    expect(r.evaluation).not.toBe('blocked')
  })
})