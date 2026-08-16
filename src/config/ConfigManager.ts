import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'jsonc-parser'
import {
  PluginConfig,
  DEFAULT_CONFIG,
  validateRequiredFields,
  applyDefaults,
  LLMProviderConfig,
  EscalationConfig,
  FallbackConfig,
  TrustBoundaryConfig,
} from '../types/PluginConfig'
import { BlockRule } from '../types/RuleTypes'

const ERROR_LOGGER_COMPONENT = 'ConfigManager'

function logError(_message: string, _error?: unknown): void {}

function logWarning(_message: string): void {}

function logInfo(_message: string): void {}

function loadDefaultBlockRules(): BlockRule[] {
  const rulesPath = path.join(__dirname, 'default-block-rules.jsonc')
  try {
    if (fs.existsSync(rulesPath)) {
      const content = fs.readFileSync(rulesPath, 'utf-8')
      const errors: any[] = []
      const result = parse(content, errors) as unknown
      if (errors.length > 0) {
        logWarning('Errors parsing default block rules, using bundled defaults')
      } else if (Array.isArray(result)) {
        const filtered = result.filter((item): item is BlockRule => {
          return (
            item !== null &&
            typeof item === 'object' &&
            'id' in item &&
            'type' in item &&
            'pattern' in item &&
            'category' in item &&
            'description' in item &&
            'severity' in item
          )
        })
        if (filtered.length > 0) {
          return filtered
        }
      }
    }
  } catch (err) {
    logWarning(`Could not load default block rules: ${(err as Error)?.message}`)
  }
  return [
    {
      id: 'BR-001',
      type: 'pattern',
      pattern: 'rm\\s+-rf\\s+',
      category: 'destruction',
      description: 'Recursive force deletion',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-002',
      type: 'pattern',
      pattern: 'docker\\s+rm\\s+-f\\s+',
      category: 'destruction',
      description: 'Docker force removal',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-003',
      type: 'pattern',
      pattern: 'chmod\\s+777',
      category: 'permissions',
      description: 'World-writable permissions',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-004',
      type: 'pattern',
      pattern: '\\.ssh\\s+id_(rsa|dsa|ecdsa|ed25519)',
      category: 'secrets',
      description: 'Private key access',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-005',
      type: 'pattern',
      pattern: 'DROP\\s+TABLE',
      category: 'destruction',
      description: 'Database table deletion',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-006',
      type: 'pattern',
      pattern: 'curl.*\\|\\s*(sh|bash)',
      category: 'execution',
      description: 'Remote script execution',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-007',
      type: 'pattern',
      pattern: 'wget.*\\|\\s*(sh|bash)',
      category: 'execution',
      description: 'Remote script download and execute',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-008',
      type: 'pattern',
      pattern: 'eval\\s*\\(',
      category: 'execution',
      description: 'Code evaluation',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-009',
      type: 'pattern',
      pattern: '\\.npmrc.*_authToken',
      category: 'secrets',
      description: 'NPM authentication token',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-010',
      type: 'pattern',
      pattern: 'AWS_SECRET_ACCESS_KEY',
      category: 'secrets',
      description: 'AWS secret access key',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-011',
      type: 'pattern',
      pattern: 'git push --force',
      category: 'collaboration',
      description: 'Forced git push',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-012',
      type: 'pattern',
      pattern: '\\.sudo',
      category: 'privilege',
      description: 'Sudo escalation',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-013',
      type: 'pattern',
      pattern: 'dd\\s+if=',
      category: 'destruction',
      description: 'Disk image write (dd)',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-014',
      type: 'pattern',
      pattern: 'mkfs',
      category: 'destruction',
      description: 'Filesystem creation (format disk)',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-015',
      type: 'pattern',
      pattern: '\\.nc\\s+.*-e\\s',
      category: 'execution',
      description: 'Netcat reverse shell',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-016',
      type: 'pattern',
      pattern: 'python.*-c.*import\\s+os',
      category: 'execution',
      description: 'Python OS module import',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-017',
      type: 'pattern',
      pattern: 'subprocess\\s*\\(',
      category: 'execution',
      description: 'Subprocess execution',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-018',
      type: 'pattern',
      pattern: '\\.system\\s*\\(',
      category: 'execution',
      description: 'System call execution',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-019',
      type: 'pattern',
      pattern: '\\.exec\\s*\\(',
      category: 'execution',
      description: 'Exec call',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-020',
      type: 'pattern',
      pattern: '\\.spawn\\s*\\(',
      category: 'execution',
      description: 'Spawn process',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-021',
      type: 'pattern',
      pattern: '\\.fork\\s*\\(',
      category: 'execution',
      description: 'Fork process',
      severity: 'low',
      enabled: true,
    },
    {
      id: 'BR-022',
      type: 'pattern',
      pattern: '\\.child_process',
      category: 'execution',
      description: 'Child process creation',
      severity: 'low',
      enabled: true,
    },
    {
      id: 'BR-023',
      type: 'pattern',
      pattern: '\\.Popen\\s*\\(',
      category: 'execution',
      description: 'Python Popen process',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-024',
      type: 'pattern',
      pattern: '\\.nohup\\s',
      category: 'execution',
      description: 'Nohangup execution',
      severity: 'low',
      enabled: true,
    },
    {
      id: 'BR-025',
      type: 'pattern',
      pattern: '\\.screen\\s',
      category: 'execution',
      description: 'Screen session creation',
      severity: 'low',
      enabled: true,
    },
    {
      id: 'BR-026',
      type: 'pattern',
      pattern: '\\.tmux\\s',
      category: 'execution',
      description: 'Tmux session creation',
      severity: 'low',
      enabled: true,
    },
    {
      id: 'BR-027',
      type: 'pattern',
      pattern: '\\.cron\\s+-e',
      category: 'execution',
      description: 'Cron job editing',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-028',
      type: 'pattern',
      pattern: '\\.systemctl\\s+start',
      category: 'execution',
      description: 'System service start',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-029',
      type: 'pattern',
      pattern: '\\.systemctl\\s+enable',
      category: 'execution',
      description: 'System service enable',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-030',
      type: 'pattern',
      pattern: '\\.iptables\\s+-F',
      category: 'security',
      description: 'Flush iptables rules',
      severity: 'critical',
      enabled: true,
    },
  ]
}

export class ConfigManager {
  private config: PluginConfig
  private configPath: string

  constructor(configPath?: string) {
    this.configPath = configPath || this.getDefaultConfigPath()
    this.config = this.loadFromPath(this.configPath)
  }

  getDefaultConfigPath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.'
    const opencodeDir = path.join(homeDir, '.opencode')
    return path.join(opencodeDir, 'auto-mode.jsonc')
  }

  loadFromPath(configPath: string): PluginConfig {
    try {
      if (!fs.existsSync(configPath)) {
        logWarning(`Config file not found at ${configPath}, using defaults`)
        const defaultConfig = { ...DEFAULT_CONFIG }
        const defaultRules = loadDefaultBlockRules()
        defaultConfig.blockRules = defaultRules
        return defaultConfig
      }

      const content = fs.readFileSync(configPath, 'utf-8')
      const errors: any[] = []
      const parsed = parse(content, errors) as unknown

      if (errors.length > 0) {
        const errorMessages = errors.map((e) => {
          return `Parse error at offset ${e.offset}: code ${e.code}`
        })
        logWarning(
          `JSONC parse errors: ${errorMessages.join(', ')}, using defaults`
        )
        const defaultConfig = { ...DEFAULT_CONFIG }
        const defaultRules = loadDefaultBlockRules()
        defaultConfig.blockRules = defaultRules
        return defaultConfig
      }

      if (!validateRequiredFields(parsed)) {
        logWarning('Missing required config fields, using defaults')
        const merged = applyDefaults(parsed)
        const defaultRules = loadDefaultBlockRules()
        merged.blockRules = defaultRules.concat(
          merged.blockRules as BlockRule[]
        )
        return merged
      }

      const merged = applyDefaults(parsed)
      const defaultRules = loadDefaultBlockRules()
      merged.blockRules = defaultRules.concat(merged.blockRules as BlockRule[])
      logInfo('Configuration loaded successfully')
      return merged
    } catch (error) {
      logError('Error loading config file', error)
      const defaultConfig = { ...DEFAULT_CONFIG }
      const defaultRules = loadDefaultBlockRules()
      defaultConfig.blockRules = defaultRules
      return defaultConfig
    }
  }

  load(configPath?: string): PluginConfig {
    if (configPath) {
      this.configPath = configPath
    }
    this.config = this.loadFromPath(this.configPath)
    this.warnInvalidFields(this.config)
    return this.getConfig()
  }

  reload(configPath?: string): PluginConfig {
    return this.load(configPath)
  }

  getConfig(): PluginConfig {
    return this.config
  }

  getLLMConfig(): LLMProviderConfig {
    return this.config.llm
  }

  getEscalationConfig(): EscalationConfig {
    return this.config.escalation
  }

  getFallbackConfig(): FallbackConfig {
    return this.config.fallback
  }

  getDenyMode(): string {
    return this.config.denyMode
  }

  getBlockRules(): unknown[] {
    return this.config.blockRules
  }

  getAllowExceptions(): unknown[] {
    return this.config.allowExceptions
  }

  getTrustBoundary(): TrustBoundaryConfig {
    return this.config.trustBoundary
  }

  getExcludedAgents(): string[] {
    return this.config.excludedAgents
  }

  isAgentExcluded(agentName: string): boolean {
    return this.config.excludedAgents.includes(agentName)
  }

  validateConfig(config: PluginConfig): string[] {
    const errors: string[] = []

    if (!config.llm) {
      errors.push('llm: missing')
      return errors
    }

    const llm = config.llm as unknown as Record<string, unknown>

    if (typeof llm.apiKey !== 'string' || !llm.apiKey) {
      errors.push('llm.apiKey: must be a non-empty string')
    }

    if (typeof llm.provider !== 'string' || !llm.provider) {
      errors.push('llm.provider: must be a non-empty string')
    }

    if (typeof llm.model !== 'string' || !llm.model) {
      errors.push('llm.model: must be a non-empty string')
    }

    if (
      typeof llm.timeout !== 'number' ||
      (llm.timeout <= 0 && llm.timeout !== -1)
    ) {
      errors.push('llm.timeout: must be a positive number or -1 for no timeout')
    }

    const validDenyModes = ['auto-retry', 'ask-user', 'both']
    if (!validDenyModes.includes(config.denyMode)) {
      errors.push(
        `denyMode: must be one of 'auto-retry', 'ask-user', 'both', got '${config.denyMode}'`
      )
    }

    if (typeof config.escalation !== 'object' || config.escalation === null) {
      errors.push('escalation: must be an object')
    } else {
      const esc = config.escalation as unknown as Record<string, unknown>
      if (
        typeof esc.consecutive !== 'number' ||
        esc.consecutive <= 0 ||
        !Number.isInteger(esc.consecutive)
      ) {
        errors.push('escalation.consecutive: must be a positive integer')
      }
      if (
        typeof esc.total !== 'number' ||
        esc.total <= 0 ||
        !Number.isInteger(esc.total)
      ) {
        errors.push('escalation.total: must be a positive integer')
      }
    }

    if (!Array.isArray(config.blockRules)) {
      errors.push('blockRules: must be an array')
    } else {
      config.blockRules.forEach((rule, index) => {
        if (typeof rule !== 'object' || rule === null) {
          errors.push(
            `blockRules[${index}]: must be an object with id, pattern, and description`
          )
        } else {
          const r = rule as Record<string, unknown>
          if (typeof r.id === 'undefined' || r.id === null) {
            errors.push(`blockRules[${index}]: missing required field 'id'`)
          }
          if (typeof r.pattern === 'undefined' || r.pattern === null) {
            errors.push(
              `blockRules[${index}]: missing required field 'pattern'`
            )
          }
          if (typeof r.description === 'undefined' || r.description === null) {
            errors.push(
              `blockRules[${index}]: missing required field 'description'`
            )
          }
        }
      })
    }

    if (!Array.isArray(config.allowExceptions)) {
      errors.push('allowExceptions: must be an array')
    } else {
      config.allowExceptions.forEach((exc, index) => {
        if (typeof exc !== 'object' || exc === null) {
          errors.push(
            `allowExceptions[${index}]: must be an object with id, agents, and tools`
          )
        } else {
          const e = exc as Record<string, unknown>
          if (typeof e.id === 'undefined' || e.id === null) {
            errors.push(
              `allowExceptions[${index}]: missing required field 'id'`
            )
          }
          if (typeof e.agents === 'undefined' || e.agents === null) {
            errors.push(
              `allowExceptions[${index}]: missing required field 'agents'`
            )
          }
          if (typeof e.tools === 'undefined' || e.tools === null) {
            errors.push(
              `allowExceptions[${index}]: missing required field 'tools'`
            )
          }
        }
      })
    }

    if (
      typeof config.trustBoundary !== 'object' ||
      config.trustBoundary === null
    ) {
      errors.push('trustBoundary: must be an object')
    } else {
      const tb = config.trustBoundary as unknown as Record<string, unknown>
      if (!Array.isArray(tb.protectedPaths)) {
        errors.push('trustBoundary.protectedPaths: must be an array of strings')
      } else {
        tb.protectedPaths.forEach((p, index) => {
          if (typeof p !== 'string') {
            errors.push(
              `trustBoundary.protectedPaths[${index}]: must be a string`
            )
          }
        })
      }
      if (!Array.isArray(tb.protectedCommands)) {
        errors.push(
          'trustBoundary.protectedCommands: must be an array of strings'
        )
      } else {
        tb.protectedCommands.forEach((c, index) => {
          if (typeof c !== 'string') {
            errors.push(
              `trustBoundary.protectedCommands[${index}]: must be a string`
            )
          }
        })
      }
    }

    return errors
  }

  isConfigValid(config: PluginConfig): boolean {
    return this.validateConfig(config).length === 0
  }

  private warnInvalidFields(config: PluginConfig): void {
    const errors = this.validateConfig(config)
    if (errors.length > 0) {
      logWarning(`Config validation found ${errors.length} issue(s):`)
      errors.forEach((error) => logWarning(`  - ${error}`))
    }
  }

  initialize(): void {
    this.config = this.loadFromPath(this.configPath)
    this.warnInvalidFields(this.config)
  }
}
