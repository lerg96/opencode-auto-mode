import * as fs from 'fs'
import * as path from 'path'
import { ConfigManager } from '../../../src/config/ConfigManager'
import {
  DEFAULT_CONFIG,
  validateRequiredFields,
  applyDefaults,
} from '../../../src/types/PluginConfig'

jest.mock('fs')
jest.mock('path')

describe('ConfigManager', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
    process.env.HOME = '/tmp/test-home'
    ;(path.join as jest.Mock).mockImplementation((...args: string[]) =>
      args.join('/')
    )
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('loadFromPath', () => {
    it('should return defaults when config file does not exist', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const manager = new ConfigManager('/nonexistent/config.jsonc')
      const config = manager.getConfig()

      expect(config.llm).toBeDefined()
      expect(config.denyMode).toBe('auto-retry')
      expect(config.escalation.consecutive).toBe(3)
      expect(config.escalation.total).toBe(20)
    })

    it('should return defaults when config file has invalid JSONC', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue('invalid jsonc {[[[')

      const manager = new ConfigManager('/test/config.jsonc')
      const config = manager.getConfig()

      expect(config.llm).toBeDefined()
      expect(config.denyMode).toBe('auto-retry')
    })

    it('should load valid config with overrides', () => {
      const validConfig = JSON.stringify({
        llm: { provider: 'openai', model: 'gpt-4', timeout: 3000 },
        denyMode: 'ask-user',
        escalation: { consecutive: 5, total: 10 },
        fallback: { onTimeout: 'allow', onError: 'deny' },
        excludedAgents: ['custom-agent'],
        blockRules: [],
        allowExceptions: [],
        trustBoundary: { protectedPaths: [], protectedCommands: [] },
      })

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(validConfig)

      const manager = new ConfigManager('/test/config.jsonc')
      const config = manager.getConfig()

      expect(config.llm.provider).toBe('openai')
      expect(config.llm.model).toBe('gpt-4')
      expect(config.llm.timeout).toBe(3000)
      expect(config.denyMode).toBe('ask-user')
      expect(config.escalation.consecutive).toBe(5)
      expect(config.escalation.total).toBe(10)
      expect(config.fallback.onTimeout).toBe('allow')
      expect(config.fallback.onError).toBe('deny')
      expect(config.excludedAgents).toContain('custom-agent')
    })

    it('should load config and merge with default block rules', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({}))

      const manager = new ConfigManager('/test/config.jsonc')
      const config = manager.getConfig()

      expect(Array.isArray(config.blockRules)).toBe(true)
    })

    it('should reset rawLlmConfig when config file is missing on reload', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ llm: { provider: 'openai', model: 'gpt-4' } })
      )

      const manager = new ConfigManager('/test/config.jsonc')
      expect(manager.getRawLlmConfig()).toBeDefined()

      ;(fs.existsSync as jest.Mock).mockReturnValue(false)
      manager.load('/other/missing.jsonc')

      expect(manager.getRawLlmConfig()).toBeUndefined()
    })

    it('should reset rawLlmConfig when reload throws', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ llm: { provider: 'openai', model: 'gpt-4' } })
      )

      const manager = new ConfigManager('/test/config.jsonc')
      expect(manager.getRawLlmConfig()).toBeDefined()

      ;(fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('disk error')
      })
      manager.load('/other/error.jsonc')

      expect(manager.getRawLlmConfig()).toBeUndefined()
    })

    it('should load injection section with overrides from config file', () => {
      const validConfig = JSON.stringify({
        llm: { provider: 'openai', model: 'gpt-4', timeout: 3000 },
        injection: {
          enabled: false,
          scanUserMessages: false,
          customPatterns: [
            { pattern: 'CONFIG_MARKER', description: 'Config marker' },
          ],
        },
      })

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(validConfig)

      const manager = new ConfigManager('/test/config.jsonc')
      const config = manager.getConfig()

      expect(config.injection.enabled).toBe(false)
      expect(config.injection.scanUserMessages).toBe(false)
      expect(config.injection.scanToolResults).toBe(true)
      expect(config.injection.customPatterns).toEqual([
        { pattern: 'CONFIG_MARKER', description: 'Config marker' },
      ])
    })

    it('should apply injection defaults when config file does not exist', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const manager = new ConfigManager('/nonexistent/config.jsonc')
      const config = manager.getConfig()

      expect(config.injection).toEqual({
        enabled: true,
        scanToolResults: true,
        scanUserMessages: true,
        customPatterns: [],
      })
    })

    it('should apply default excludedAgents when config omits them', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ llm: { provider: 'openai', model: 'gpt-4' } })
      )

      const manager = new ConfigManager('/test/config.jsonc')
      const config = manager.getConfig()

      expect(config.excludedAgents).toEqual(['explore', 'research'])
      expect(manager.isAgentExcluded('explore')).toBe(true)
    })

    it('should keep custom excludedAgents when provided', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          llm: { provider: 'openai', model: 'gpt-4' },
          excludedAgents: ['my-agent'],
        })
      )

      const manager = new ConfigManager('/test/config.jsonc')
      const config = manager.getConfig()

      expect(config.excludedAgents).toEqual(['my-agent'])
      expect(manager.isAgentExcluded('my-agent')).toBe(true)
      expect(manager.isAgentExcluded('explore')).toBe(false)
    })
  })

  describe('load', () => {
    it('should use custom config path when provided', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const manager = new ConfigManager()
      manager.load('/custom/path/config.jsonc')

      expect(fs.existsSync).toHaveBeenCalledWith('/custom/path/config.jsonc')
    })
  })

  describe('reload', () => {
    it('should reload configuration from the same path', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const manager = new ConfigManager('/test/config.jsonc')
      manager.reload()

      expect(fs.existsSync).toHaveBeenCalledWith('/test/config.jsonc')
    })
  })

  describe('getConfig accessors', () => {
    it('should provide typed access to config values', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const manager = new ConfigManager('/test/config.jsonc')

      expect(manager.getLLMConfig()).toBeDefined()
      expect(manager.getEscalationConfig()).toBeDefined()
      expect(manager.getFallbackConfig()).toBeDefined()
      expect(manager.getDenyMode()).toBe('auto-retry')
      expect(manager.getBlockRules()).toBeDefined()
      expect(manager.getAllowExceptions()).toBeDefined()
      expect(manager.getTrustBoundary()).toBeDefined()
      expect(manager.getExcludedAgents()).toBeDefined()
      expect(manager.isAgentExcluded('explore')).toBe(true)
      expect(manager.isAgentExcluded('unknown-agent')).toBe(false)
    })
  })

  describe('getDefaultConfigPath', () => {
    it('should return default path in HOME/.config/opencode/', () => {
      const manager = new ConfigManager()
      const defaultPath = manager.getDefaultConfigPath()

      expect(defaultPath).toContain('.config')
      expect(defaultPath).toContain('opencode')
      expect(defaultPath).toContain('auto-mode.jsonc')
    })
  })
})

describe('validateRequiredFields', () => {
  it('should return true for valid config', () => {
    const valid = {
      llm: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        timeout: 5000,
      },
    }
    expect(validateRequiredFields(valid)).toBe(true)
  })

  it('should return false for null', () => {
    expect(validateRequiredFields(null)).toBe(false)
  })

  it('should return false for string', () => {
    expect(validateRequiredFields('invalid')).toBe(false)
  })

  it('should return false for missing llm', () => {
    const invalid = { denyMode: 'auto-retry' }
    expect(validateRequiredFields(invalid)).toBe(false)
  })

  it('should return false for missing provider', () => {
    const invalid = { llm: { model: 'test' } }
    expect(validateRequiredFields(invalid)).toBe(false)
  })

  it('should return false for missing model', () => {
    const invalid = { llm: { provider: 'anthropic' } }
    expect(validateRequiredFields(invalid)).toBe(false)
  })

  it('should return false for invalid provider', () => {
    const invalid = { llm: { provider: 'invalid', model: 'test' } }
    expect(validateRequiredFields(invalid)).toBe(false)
  })

  // Edge cases for llm field
  it('should return true for valid config with empty llm object containing required fields', () => {
    const valid = {
      llm: {
        provider: 'openai',
        model: 'test-model',
      },
    }
    expect(validateRequiredFields(valid)).toBe(true)
  })

  it('should return false for llm as null', () => {
    const invalid = { llm: null }
    expect(validateRequiredFields(invalid)).toBe(false)
  })

  it('should return false for llm as empty object without required properties', () => {
    const invalid = { llm: {} }
    expect(validateRequiredFields(invalid)).toBe(false)
  })

  it('should return true when llm has timeout 0', () => {
    const valid = {
      llm: {
        provider: 'anthropic',
        model: 'test',
        timeout: 0,
      },
    }
    expect(validateRequiredFields(valid)).toBe(true)
  })

  it('should return true when llm has negative timeout', () => {
    const valid = {
      llm: {
        provider: 'anthropic',
        model: 'test',
        timeout: -1,
      },
    }
    expect(validateRequiredFields(valid)).toBe(true)
  })

  it('should return false when llm.provider is null', () => {
    const invalid = { llm: { model: 'test', provider: null } }
    expect(validateRequiredFields(invalid)).toBe(false)
  })

  it('should return false when llm.provider is empty string', () => {
    const invalid = { llm: { model: 'test', provider: '' } }
    expect(validateRequiredFields(invalid)).toBe(false)
  })

  it('should return false when llm.model is empty string', () => {
    const invalid = { llm: { provider: 'anthropic', model: '' } }
    expect(validateRequiredFields(invalid)).toBe(false)
  })

  it('should return false when config is a number', () => {
    expect(validateRequiredFields(42)).toBe(false)
  })

  it('should return false when config is an array', () => {
    expect(validateRequiredFields([])).toBe(false)
  })
})

describe('applyDefaults', () => {
  it('should apply all defaults for empty object', () => {
    const result = applyDefaults({})

    expect(result.llm.provider).toBe('anthropic')
    expect(result.llm.timeout).toBe(5000)
    expect(result.denyMode).toBe('auto-retry')
    expect(result.escalation.consecutive).toBe(3)
    expect(result.fallback.onTimeout).toBe('ask-user')
  })

  it('should merge partial config with defaults', () => {
    const partial = {
      llm: { provider: 'openai', model: 'gpt-4' },
      denyMode: 'both',
    }

    const result = applyDefaults(partial)

    expect(result.llm.provider).toBe('openai')
    expect(result.llm.model).toBe('gpt-4')
    expect(result.llm.timeout).toBe(5000)
    expect(result.denyMode).toBe('both')
    expect(result.fallback.onTimeout).toBe('ask-user')
  })

  it('should handle undefined input', () => {
    const result = applyDefaults(undefined)
    expect(result.llm.provider).toBe('anthropic')
  })

  it('should apply injection defaults for empty object', () => {
    const result = applyDefaults({})

    expect(result.injection).toEqual({
      enabled: true,
      scanToolResults: true,
      scanUserMessages: true,
      customPatterns: [],
    })
  })

  it('should merge partial injection config with defaults', () => {
    const result = applyDefaults({
      injection: {
        scanToolResults: false,
        customPatterns: [
          { pattern: 'CUSTOM_MARKER', description: 'Custom marker' },
        ],
      },
    })

    expect(result.injection.enabled).toBe(true)
    expect(result.injection.scanToolResults).toBe(false)
    expect(result.injection.scanUserMessages).toBe(true)
    expect(result.injection.customPatterns).toEqual([
      { pattern: 'CUSTOM_MARKER', description: 'Custom marker' },
    ])
  })

  it('should fall back to default customPatterns when injection.customPatterns is not an array', () => {
    const result = applyDefaults({
      injection: { customPatterns: 'not-an-array' as any },
    })

    expect(result.injection.customPatterns).toEqual([])
  })

  it('should not alias customPatterns to the shared default array', () => {
    const first = applyDefaults({})
    const second = applyDefaults({})

    first.injection.customPatterns!.push({ pattern: 'MUT', description: 'd' })

    expect(second.injection.customPatterns).toEqual([])
  })
})

describe('ConfigManager - Extensible Rules Framework', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
    process.env.HOME = '/tmp/test-home'
    ;(path.join as jest.Mock).mockImplementation((...args: string[]) =>
      args.join('/')
    )
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('custom rules are loaded from config', () => {
    it('should load custom block rules from config file', () => {
      const customRules = [
        {
          id: 'BR-CUSTOM-001',
          type: 'pattern',
          pattern: 'dangerous-command',
          category: 'custom',
          description: 'Block dangerous command',
          severity: 'high',
          enabled: true,
        },
      ]

      const configWithCustomRules = JSON.stringify({
        blockRules: customRules,
        allowExceptions: [],
        trustBoundary: { protectedPaths: [], protectedCommands: [] },
      })

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(configWithCustomRules)

      const manager = new ConfigManager('/test/config.jsonc')
      const config = manager.getConfig()

      const customRuleFound = config.blockRules.find(
        (r: any) => r.id === 'BR-CUSTOM-001'
      )
      expect(customRuleFound).toBeDefined()
      expect((customRuleFound as any).pattern).toBe('dangerous-command')
    })

    it('should load custom allow exceptions from config file', () => {
      const customExceptions = [
        {
          id: 'AE-CUSTOM-001',
          type: 'pattern',
          pattern: 'safe-operation',
          description: 'Allow safe operation',
          enabled: true,
        },
      ]

      const configWithCustomExceptions = JSON.stringify({
        blockRules: [],
        allowExceptions: customExceptions,
        trustBoundary: { protectedPaths: [], protectedCommands: [] },
      })

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(
        configWithCustomExceptions
      )

      const manager = new ConfigManager('/test/config.jsonc')
      const config = manager.getConfig()

      const customExceptionFound = config.allowExceptions.find(
        (e: any) => e.id === 'AE-CUSTOM-001'
      )
      expect(customExceptionFound).toBeDefined()
      expect((customExceptionFound as any).pattern).toBe('safe-operation')
    })
  })

  describe('custom rules are merged with default rules', () => {
    it('should include both default rules and custom rules', () => {
      const customRules = [
        {
          id: 'BR-CUSTOM-001',
          type: 'pattern',
          pattern: 'custom-pattern',
          category: 'custom',
          description: 'Custom rule',
          severity: 'high',
          enabled: true,
        },
      ]

      const configWithCustomRules = JSON.stringify({
        blockRules: customRules,
        allowExceptions: [],
        trustBoundary: { protectedPaths: [], protectedCommands: [] },
      })

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(configWithCustomRules)

      const manager = new ConfigManager('/test/config.jsonc')
      const config = manager.getConfig()

      const defaultRuleFound = config.blockRules.find(
        (r: any) => r.id === 'BR-001'
      )
      const customRuleFound = config.blockRules.find(
        (r: any) => r.id === 'BR-CUSTOM-001'
      )

      expect(defaultRuleFound).toBeDefined()
      expect(customRuleFound).toBeDefined()
      expect(config.blockRules.length).toBeGreaterThan(30)
    })

    it('should append custom rules after default rules', () => {
      const customRules = [
        {
          id: 'BR-CUSTOM-001',
          type: 'pattern',
          pattern: 'custom-pattern',
          category: 'custom',
          description: 'Custom rule',
          severity: 'high',
          enabled: true,
        },
      ]

      const configWithCustomRules = JSON.stringify({
        blockRules: customRules,
        allowExceptions: [],
        trustBoundary: { protectedPaths: [], protectedCommands: [] },
      })

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(configWithCustomRules)

      const manager = new ConfigManager('/test/config.jsonc')
      const config = manager.getConfig()

      const defaultRuleIndices: number[] = []
      const customRuleIndices: number[] = []

      config.blockRules.forEach((rule: any, index: number) => {
        if (rule.id.startsWith('BR-00')) {
          defaultRuleIndices.push(index)
        } else if (rule.id.startsWith('BR-CUSTOM')) {
          customRuleIndices.push(index)
        }
      })

      if (defaultRuleIndices.length > 0 && customRuleIndices.length > 0) {
        const maxDefaultIndex = Math.max(...defaultRuleIndices)
        const minCustomIndex = Math.min(...customRuleIndices)
        expect(minCustomIndex).toBeGreaterThan(maxDefaultIndex)
      }
    })
  })

  describe('custom allow exceptions override default block rules', () => {
    it('should allow exception to override a matching block rule', () => {
      const configWithException = JSON.stringify({
        blockRules: [],
        allowExceptions: [
          {
            id: 'AE-CUSTOM-OVERRIDE',
            type: 'pattern',
            pattern: 'rm -rf',
            description: 'Override rm -rf block',
            enabled: true,
          },
        ],
        trustBoundary: { protectedPaths: [], protectedCommands: [] },
      })

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(configWithException)

      const manager = new ConfigManager('/test/config.jsonc')
      const config = manager.getConfig()

      const exceptionFound = config.allowExceptions.find(
        (e: any) => e.id === 'AE-CUSTOM-OVERRIDE'
      )
      expect(exceptionFound).toBeDefined()
      expect((exceptionFound as any).pattern).toBe('rm -rf')
    })

    it('should have custom exceptions that match dangerous commands', () => {
      const exceptions = [
        {
          id: 'AE-OVERRIDE-RM',
          type: 'pattern',
          pattern: 'rm -rf node_modules --force',
          description: 'Allow rm node_modules with force',
          enabled: true,
        },
        {
          id: 'AE-OVERRIDE-SUDO',
          type: 'pattern',
          pattern: 'sudo npm install',
          description: 'Allow sudo for npm install only',
          enabled: true,
        },
      ]

      const configWithExceptions = JSON.stringify({
        blockRules: [],
        allowExceptions: exceptions,
        trustBoundary: { protectedPaths: [], protectedCommands: [] },
      })

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(configWithExceptions)

      const manager = new ConfigManager('/test/config.jsonc')
      const config = manager.getConfig()

      expect(config.allowExceptions.length).toBe(12)
      expect((config.allowExceptions as any[])[10].id).toBe('AE-OVERRIDE-RM')
      expect((config.allowExceptions as any[])[11].id).toBe('AE-OVERRIDE-SUDO')
    })
  })

  describe('custom rules with regex patterns', () => {
    it('should load custom rules with regex pattern prefix', () => {
      const customRegexRule = [
        {
          id: 'BR-REGEX-001',
          type: 'pattern',
          pattern: 'regex:os\\.remove\\s*\\(',
          category: 'custom',
          description: 'Block Python os.remove()',
          severity: 'high',
          enabled: true,
        },
      ]

      const config = JSON.stringify({
        blockRules: customRegexRule,
        allowExceptions: [],
        trustBoundary: { protectedPaths: [], protectedCommands: [] },
      })

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(config)

      const manager = new ConfigManager('/test/config.jsonc')
      const loadedConfig = manager.getConfig()

      const regexRule = loadedConfig.blockRules.find(
        (r: any) => r.id === 'BR-REGEX-001'
      )
      expect(regexRule).toBeDefined()
      expect((regexRule as any).pattern).toBe('regex:os\\.remove\\s*\\(')
    })
  })

  describe('multiple custom rules loading', () => {
    it('should load multiple custom block rules', () => {
      const customRules = [
        {
          id: 'BR-CUSTOM-001',
          type: 'pattern',
          pattern: 'pattern-1',
          category: 'custom',
          description: 'Custom rule 1',
          severity: 'high',
          enabled: true,
        },
        {
          id: 'BR-CUSTOM-002',
          type: 'pattern',
          pattern: 'pattern-2',
          category: 'custom',
          description: 'Custom rule 2',
          severity: 'medium',
          enabled: true,
        },
        {
          id: 'BR-CUSTOM-003',
          type: 'pattern',
          pattern: 'pattern-3',
          category: 'custom',
          description: 'Custom rule 3',
          severity: 'low',
          enabled: false,
        },
      ]

      const config = JSON.stringify({
        blockRules: customRules,
        allowExceptions: [],
        trustBoundary: { protectedPaths: [], protectedCommands: [] },
      })

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(fs.readFileSync as jest.Mock).mockReturnValue(config)

      const manager = new ConfigManager('/test/config.jsonc')
      const loadedConfig = manager.getConfig()

      const customCount = loadedConfig.blockRules.filter((r: any) =>
        r.id.startsWith('BR-CUSTOM')
      ).length
      expect(customCount).toBe(3)
    })
  })
})

describe('ConfigManager - DEFAULT_CONFIG aliasing safety', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
    process.env.HOME = '/tmp/test-home'
    ;(path.join as jest.Mock).mockImplementation((...args: string[]) =>
      args.join('/')
    )
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should deep-clone trustBoundary so it is not aliased to DEFAULT_TRUST_BOUNDARY', () => {
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)

    const manager1 = new ConfigManager('/missing1.jsonc')
    const config1 = manager1.getConfig()

    config1.trustBoundary.protectedPaths.push('MUTATED')

    const manager2 = new ConfigManager('/missing2.jsonc')
    const config2 = manager2.getConfig()

    expect(config2.trustBoundary.protectedPaths).not.toContain('MUTATED')
  })

  it('should deep-clone excludedAgents via structuredClone path', () => {
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)

    const manager1 = new ConfigManager('/missing1.jsonc')
    const config1 = manager1.getConfig()

    config1.excludedAgents.push('MUTATED')

    const manager2 = new ConfigManager('/missing2.jsonc')
    const config2 = manager2.getConfig()

    expect(config2.excludedAgents).not.toContain('MUTATED')
  })

  it('should deep-clone trustBoundary after parse error', () => {
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as jest.Mock).mockReturnValue('invalid jsonc {[[[')

    const manager1 = new ConfigManager('/test1/config.jsonc')
    const config1 = manager1.getConfig()

    config1.trustBoundary.protectedPaths.push('MUTATED')

    const manager2 = new ConfigManager('/test2/config.jsonc')
    const config2 = manager2.getConfig()

    expect(config2.trustBoundary.protectedPaths).not.toContain('MUTATED')
  })

  it('should deep-clone trustBoundary after file read error', () => {
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
    ;(fs.readFileSync as jest.Mock).mockImplementation(() => {
      throw new Error('disk error')
    })

    const manager1 = new ConfigManager('/error1/config.jsonc')
    const config1 = manager1.getConfig()

    config1.trustBoundary.protectedPaths.push('MUTATED')

    const manager2 = new ConfigManager('/error2/config.jsonc')
    const config2 = manager2.getConfig()

    expect(config2.trustBoundary.protectedPaths).not.toContain('MUTATED')
  })
})
