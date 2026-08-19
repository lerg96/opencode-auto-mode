import { ConfigManager } from '../../../src/config/ConfigManager'
import { PluginConfig, DEFAULT_CONFIG } from '../../../src/types/PluginConfig'
import * as path from 'path'

describe('ConfigManager validateConfig', () => {
  let configManager: ConfigManager

  beforeEach(() => {
    configManager = new ConfigManager(
      path.join('/tmp', 'config-manager-test-' + Date.now(), 'test.jsonc')
    )
  })

  describe('llm validation', () => {
    it('should error when llm is missing', () => {
      const config = {} as PluginConfig
      const errors = configManager.validateConfig(config)
      expect(errors).toContain('llm: missing')
    })

    it('should error when apiKey is empty', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        llm: { ...DEFAULT_CONFIG.llm, apiKey: '' } as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain('llm.apiKey: must be a non-empty string')
    })

    it('should error when apiKey is not a string', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        llm: { ...DEFAULT_CONFIG.llm, apiKey: 123 as unknown as string } as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain('llm.apiKey: must be a non-empty string')
    })

    it('should error when provider is empty', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        llm: { ...DEFAULT_CONFIG.llm, provider: '' } as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain('llm.provider: must be a non-empty string')
    })

    it('should error when model is missing', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        llm: { ...DEFAULT_CONFIG.llm, model: '' } as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain('llm.model: must be a non-empty string')
    })

    it('should error when timeout is zero', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        llm: { ...DEFAULT_CONFIG.llm, timeout: 0 } as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain(
        'llm.timeout: must be a positive number or -1 for no timeout'
      )
    })

    it('should error when timeout is negative (other than -1)', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        llm: { ...DEFAULT_CONFIG.llm, timeout: -5 } as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain(
        'llm.timeout: must be a positive number or -1 for no timeout'
      )
    })

    it('should accept timeout of -1 (no timeout)', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        llm: {
          provider: 'test',
          model: 'test',
          apiKey: 'key',
          timeout: -1,
        } as any,
      }
      const errors = configManager.validateConfig(config)
      const timeoutError = errors.find((e) => e.includes('timeout'))
      expect(timeoutError).toBeUndefined()
    })
  })

  describe('denyMode validation', () => {
    it('should error for invalid denyMode', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        denyMode: 'invalid-mode' as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain(
        "denyMode: must be one of 'auto-retry', 'ask-user', 'both', got 'invalid-mode'"
      )
    })

    it('should accept valid denyMode values', () => {
      for (const mode of ['auto-retry', 'ask-user', 'both']) {
        const config: PluginConfig = {
          ...DEFAULT_CONFIG,
          denyMode: mode as any,
        }
        const errors = configManager.validateConfig(config)
        expect(errors.filter((e) => e.includes('denyMode'))).toEqual([])
      }
    })
  })

  describe('escalation validation', () => {
    it('should error when escalation is not an object', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        escalation: 'not-an-object' as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain('escalation: must be an object')
    })

    it('should error when consecutive is not a positive integer', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        escalation: { ...DEFAULT_CONFIG.escalation, consecutive: 0 } as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain(
        'escalation.consecutive: must be a positive integer'
      )
    })

    it('should error when total is not a positive integer', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        escalation: { ...DEFAULT_CONFIG.escalation, total: -1 } as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain('escalation.total: must be a positive integer')
    })

    it('should accept valid escalation config', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        escalation: { consecutive: 3, total: 20 } as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors.filter((e) => e.includes('escalation'))).toEqual([])
    })
  })

  describe('blockRules validation', () => {
    it('should error when blockRules is not an array', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        blockRules: 'not-an-array' as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain('blockRules: must be an array')
    })

    it('should error when blockRules contains non-objects', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        blockRules: ['not-an-object'] as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain(
        'blockRules[0]: must be an object with id, pattern, and description'
      )
    })

    it('should error when blockRule missing id', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        blockRules: [{ pattern: 'test', description: 'test rule' }] as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain("blockRules[0]: missing required field 'id'")
    })

    it('should error when blockRule missing pattern', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        blockRules: [{ id: 'BR-001', description: 'test' }] as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain(
        "blockRules[0]: missing required field 'pattern'"
      )
    })

    it('should error when blockRule missing description', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        blockRules: [{ id: 'BR-001', pattern: 'test' }] as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain(
        "blockRules[0]: missing required field 'description'"
      )
    })

    it('should accept a valid blockRules array', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        blockRules: [
          {
            id: 'BR-001',
            type: 'pattern',
            pattern: 'test',
            category: 'test',
            description: 'test',
            severity: 'medium' as const,
            enabled: true,
          },
        ] as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors.filter((e) => e.includes('blockRules'))).toEqual([])
    })
  })

  describe('allowExceptions validation', () => {
    it('should error when allowExceptions is not an array', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        allowExceptions: 'not-an-array' as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain('allowExceptions: must be an array')
    })

    it('should error when allowException missing required fields', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        allowExceptions: [{ id: 'AE-001' }] as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain(
        "allowExceptions[0]: missing required field 'pattern'"
      )
      expect(errors).toContain(
        "allowExceptions[0]: missing required field 'description'"
      )
    })

    it('should accept valid allowExceptions', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        allowExceptions: [
          {
            id: 'AE-001',
            type: 'pattern',
            pattern: 'safe-cmd',
            description: 'safe',
            enabled: true,
          },
        ] as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors.filter((e) => e.includes('allowExceptions'))).toEqual([])
    })
  })

  describe('trustBoundary validation', () => {
    it('should error when trustBoundary is not an object', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        trustBoundary: null as any,
      }
      const errors = configManager.validateConfig(config)
      expect(errors).toContain('trustBoundary: must be an object')
    })

    it('should error when protectedPaths contains non-strings', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        trustBoundary: {
          protectedPaths: ['string', 123 as unknown as string],
          protectedCommands: [],
        } as any,
      }
      const errors = configManager.validateConfig(config)
      const matching = errors.find(
        (e) => e.includes('protectedPaths') && e.includes('1')
      )
      expect(matching).toBeDefined()
    })

    it('should error when protectedCommands contains non-strings', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        trustBoundary: {
          protectedPaths: [],
          protectedCommands: ['sudo', 42 as unknown as string],
        } as any,
      }
      const errors = configManager.validateConfig(config)
      const matching = errors.find(
        (e) => e.includes('protectedCommands') && e.includes('1')
      )
      expect(matching).toBeDefined()
    })

    it('should accept valid trustBoundary', () => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        trustBoundary: {
          protectedPaths: ['/etc/', '~/.ssh/'],
          protectedCommands: ['sudo', 'rm'],
        },
      } as PluginConfig
      const errors = configManager.validateConfig(config)
      expect(errors.filter((e) => e.includes('trustBoundary'))).toEqual([])
    })
  })

  describe('isConfigValid', () => {
    it('should return true for valid config', () => {
      const validConfig: PluginConfig = {
        ...DEFAULT_CONFIG,
        llm: {
          provider: 'test',
          model: 'test',
          apiKey: 'key',
          timeout: 5000,
        } as any,
      }
      expect(configManager.isConfigValid(validConfig)).toBe(true)
    })

    it('should return false for invalid config', () => {
      const invalidConfig = {} as PluginConfig
      expect(configManager.isConfigValid(invalidConfig)).toBe(false)
    })
  })

  describe('initialize', () => {
    it('should load config internally on initialize', () => {
      const testPath = path.join('/tmp', 'auto-mode-initialize-test.jsonc')
      const cm = new ConfigManager(testPath)

      cm.initialize()

      // initialize stores config directly in this.config, not return it
      const config = cm.getConfig()
      expect(config.blockRules).toBeDefined()
      expect(Array.isArray(config.blockRules)).toBe(true)
    })
  })
})
