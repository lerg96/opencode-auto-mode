import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
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
import { BlockRule, AllowException } from '../types/RuleTypes'

const ERROR_LOGGER_COMPONENT = 'ConfigManager'

function logError(_message: string, _error?: unknown): void {}

function logWarning(_message: string): void {}

function logInfo(_message: string): void {}

function resolveModuleDir(): string {
  const candidates: string[] = []
  try {
    candidates.push(path.dirname(fileURLToPath(import.meta.url)))
  } catch {
    // import.meta unavailable in this environment
  }
  if (typeof __dirname !== 'undefined') {
    candidates.push(__dirname)
  }
  candidates.push(process.cwd())
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'default-block-rules.jsonc'))) {
      return candidate
    }
  }
  return candidates[0] ?? process.cwd()
}

function loadDefaultBlockRules(): BlockRule[] {
  const rulesPath = path.join(resolveModuleDir(), 'default-block-rules.jsonc')
  try {
    if (fs.existsSync(rulesPath)) {
      const content = fs.readFileSync(rulesPath, 'utf-8')
      const errors: any[] = []
      const result = parse(content, errors, {
        allowTrailingComma: true,
      }) as unknown
      const realErrors = errors.filter((e) => e && typeof e === 'object')
      if (realErrors.length > 0) {
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
      pattern: 'rm\\s+-{1,2}[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|rm\\s+-{1,2}[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*',
      category: 'destruction',
      description: 'Recursive force deletion (incl. -fr, -Rf, no-space variants)',
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
      pattern: 'docker\\s+rmi\\s+-f\\s+',
      category: 'destruction',
      description: 'Docker image force removal',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-004',
      type: 'pattern',
      pattern: 'docker\\s+system\\s+prune\\s+-f',
      category: 'destruction',
      description: 'Docker system prune force',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-005',
      type: 'pattern',
      pattern: 'rm\\s+-rf\\s+node_modules',
      category: 'destruction',
      description: 'Remove node_modules force',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-006',
      type: 'pattern',
      pattern: '/etc/',
      category: 'configuration',
      description: 'System configuration path access',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-007',
      type: 'pattern',
      pattern: '/etc/hosts',
      category: 'configuration',
      description: 'Hosts file modification',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-008',
      type: 'pattern',
      pattern: 'sudo\\s+',
      category: 'configuration',
      description: 'Privilege escalation via sudo',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-009',
      type: 'pattern',
      pattern: 'sudo\\s+chmod\\s+',
      category: 'configuration',
      description: 'Sudo chmod execution',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-010',
      type: 'pattern',
      pattern: 'chmod\\s+777',
      category: 'configuration',
      description: 'World-writable permissions',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-011',
      type: 'pattern',
      pattern: 'systemctl\\s+(restart|stop|disable)',
      category: 'configuration',
      description: 'System service modification',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-012',
      type: 'pattern',
      pattern: '~/.ssh/',
      category: 'security',
      description: 'SSH key directory access',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-013',
      type: 'pattern',
      pattern: '~/.env',
      category: 'security',
      description: 'Environment file access',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-014',
      type: 'pattern',
      pattern: 'echo\\s+\\$[A-Z_]+',
      category: 'security',
      description: 'Environment variable exposure',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-015',
      type: 'pattern',
      pattern: 'cat\\s+.*id_rsa',
      category: 'security',
      description: 'SSH private key exposure',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-016',
      type: 'pattern',
      pattern: 'python.*-c.*import\\s+os',
      category: 'execution',
      description: 'Python OS module import via inline execution',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-017',
      type: 'pattern',
      pattern: 'subprocess\\s*\\(',
      category: 'execution',
      description: 'Subprocess execution via inline code',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-018',
      type: 'pattern',
      pattern: '\\.system\\s*\\(',
      category: 'execution',
      description: 'System call execution via inline code',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-019',
      type: 'pattern',
      pattern: '\\.exec\\s*\\(',
      category: 'execution',
      description: 'Exec call via inline code',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-020',
      type: 'pattern',
      pattern: '\\.spawn\\s*\\(',
      category: 'execution',
      description: 'Spawn process call via inline code',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-021',
      type: 'pattern',
      pattern: '\\.fork\\s*\\(',
      category: 'execution',
      description: 'Fork process call via inline code',
      severity: 'low',
      enabled: true,
    },
    {
      id: 'BR-022',
      type: 'pattern',
      pattern: '\\.child_process',
      category: 'execution',
      description: 'Child process creation via inline code',
      severity: 'low',
      enabled: true,
    },
    {
      id: 'BR-023',
      type: 'pattern',
      pattern: '\\.Popen\\s*\\(',
      category: 'execution',
      description: 'Python Popen process via inline code',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-031',
      type: 'pattern',
      pattern: 'openssl\\s+',
      category: 'security',
      description: 'SSL certificate manipulation',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-032',
      type: 'pattern',
      pattern: 'iptables',
      category: 'network',
      description: 'Firewall modification',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-033',
      type: 'pattern',
      pattern: 'ufw',
      category: 'network',
      description: 'Ubuntu firewall modification',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-034',
      type: 'pattern',
      pattern: 'nmap',
      category: 'network',
      description: 'Network port scanning',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-035',
      type: 'pattern',
      pattern: 'DROP\\s+TABLE',
      category: 'database',
      description: 'Database table destruction',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-036',
      type: 'pattern',
      pattern: 'DELETE\\s+FROM\\b(?!.*\\bWHERE\\b)',
      category: 'database',
      description: 'DELETE without WHERE clause (dangerous)',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-037',
      type: 'pattern',
      pattern: 'TRUNCATE\\s+',
      category: 'database',
      description: 'Database table truncation',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-038',
      type: 'pattern',
      pattern: 'git\\s+push\\s+(?:-f\\b|--force\\b)|git\\s+push\\s+.*\\s--force\\b',
      category: 'version-control',
      description: 'Git force push (history rewrite, incl. -f and -u ... --force)',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-024',
      type: 'pattern',
      pattern: 'git\\s+reset\\s+(--hard|--soft)',
      category: 'version-control',
      description: 'Git reset (potential history loss)',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-025',
      type: 'pattern',
      pattern: 'kubectl\\s+delete',
      category: 'cloud',
      description: 'Kubernetes resource deletion',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-026',
      type: 'pattern',
      pattern: 'iam:(CreateUser|DeleteRole|PutPolicy)',
      category: 'cloud',
      description: 'AWS IAM modification',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-027',
      type: 'pattern',
      pattern: 'aws\\s+iam\\s+',
      category: 'cloud',
      description: 'AWS IAM command execution',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-028',
      type: 'pattern',
      pattern: 'crontab\\s+-e',
      category: 'system-admin',
      description: 'Cron job modification',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-029',
      type: 'pattern',
      pattern: 'insmod\\s+',
      category: 'system-admin',
      description: 'Kernel module loading',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-030',
      type: 'pattern',
      pattern: 'modprobe\\s+',
      category: 'system-admin',
      description: 'Kernel module loading',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-039',
      type: 'pattern',
      pattern: 'rm\\s+-{1,2}[a-zA-Z]*r[a-zA-Z]*\\s+[/.]\\s*$',
      category: 'destruction',
      description: 'Recursive deletion of root or current directory',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-040',
      type: 'pattern',
      pattern: 'rm\\s+--recursive\\b[^;|]*--force\\b|rm\\s+--force\\b[^;|]*--recursive\\b',
      category: 'destruction',
      description: 'Long-form recursive force deletion',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-041',
      type: 'pattern',
      pattern: 'xargs\\s+rm\\s+',
      category: 'destruction',
      description: 'Deletion via xargs',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-042',
      type: 'pattern',
      pattern: 'find\\s+.*-delete\\b',
      category: 'destruction',
      description: 'Recursive deletion via find -delete',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-043',
      type: 'pattern',
      pattern: 'dd\\s+if=.*of=/dev/',
      category: 'destruction',
      description: 'Raw disk write via dd',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-044',
      type: 'pattern',
      pattern: 'mkfs\\b',
      category: 'destruction',
      description: 'Filesystem formatting',
      severity: 'critical',
      enabled: true,
    },
    {
      id: 'BR-045',
      type: 'pattern',
      pattern: '\\bshutdown\\b',
      category: 'system-admin',
      description: 'System shutdown',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-046',
      type: 'pattern',
      pattern: '\\breboot\\b',
      category: 'system-admin',
      description: 'System reboot',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-047',
      type: 'pattern',
      pattern: 'curl\\s+.*\\|\\s*(?:bash|sh)\\b',
      category: 'execution',
      description: 'Remote code execution via curl pipe to shell',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-048',
      type: 'pattern',
      pattern: 'wget\\s+.*\\|\\s*(?:bash|sh)\\b',
      category: 'execution',
      description: 'Remote code execution via wget pipe to shell',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-049',
      type: 'pattern',
      pattern: 'docker\\s+run\\s+.*--privileged',
      category: 'execution',
      description: 'Privileged container execution',
      severity: 'high',
      enabled: true,
    },
    {
      id: 'BR-050',
      type: 'pattern',
      pattern: 'chmod\\s+-{1,2}[a-zA-Z]*R[a-zA-Z]*\\s+',
      category: 'configuration',
      description: 'Recursive chmod',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-051',
      type: 'pattern',
      pattern: 'chown\\s+-{1,2}[a-zA-Z]*R[a-zA-Z]*\\s+',
      category: 'configuration',
      description: 'Recursive chown',
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'BR-052',
      type: 'pattern',
      pattern: 'chmod\\s+7\\s+7\\s+7\\b',
      category: 'configuration',
      description: 'Spaced octal world-writable permissions',
      severity: 'high',
      enabled: true,
    },
  ]
}

function loadDefaultAllowExceptions(): AllowException[] {
  const rulesPath = path.join(resolveModuleDir(), 'default-block-rules.jsonc')
  try {
    if (fs.existsSync(rulesPath)) {
      const content = fs.readFileSync(rulesPath, 'utf-8')
      const errors: any[] = []
      const result = parse(content, errors, { allowTrailingComma: true })
      const realErrors = errors.filter((e) => e && typeof e === 'object')
      if (realErrors.length > 0) {
        logWarning(
          'Errors parsing default allow exceptions, using bundled defaults'
        )
      } else if (Array.isArray(result)) {
        const filtered = result.filter((item): item is AllowException => {
          return (
            item !== null &&
            typeof item === 'object' &&
            'id' in item &&
            'type' in item &&
            'pattern' in item &&
            'enabled' in item &&
            'description' in item &&
            !('category' in item) &&
            !('severity' in item)
          )
        })
        if (filtered.length > 0) {
          return filtered
        }
      }
    }
  } catch (err) {
    logWarning(
      `Could not load default allow exceptions: ${(err as Error)?.message}`
    )
  }
  return [
    {
      id: 'AE-001',
      type: 'pattern',
      pattern: 'rm\\s+-rf\\s+node_modules\\s+--force\\s*$',
      description: 'Allow rm node_modules with explicit --force flag (anchored to reject trailing args)',
      enabled: true,
    },
    {
      id: 'AE-002',
      type: 'pattern',
      pattern: 'chmod\\s+644',
      description: 'Allow chmod 644 (read/write owner, read others)',
      enabled: true,
    },
    {
      id: 'AE-003',
      type: 'pattern',
      pattern: 'chmod\\s+755',
      description: 'Allow chmod 755 (rwxr-xr-x)',
      enabled: true,
    },
    {
      id: 'AE-004',
      type: 'pattern',
      pattern: 'cat\\s+\\.\\.\\/\\.env\\.example',
      description: 'Allow reading .env.example template files',
      enabled: true,
    },
    {
      id: 'AE-005',
      type: 'pattern',
      pattern: 'openssl\\s+version',
      description: 'Allow checking OpenSSL version',
      enabled: true,
    },
    {
      id: 'AE-006',
      type: 'pattern',
      pattern: 'git\\s+push\\s+--force-with-lease',
      description: 'Allow safe force push with lease',
      enabled: true,
    },
    {
      id: 'AE-007',
      type: 'pattern',
      pattern: 'systemctl\\s+status',
      description: 'Allow checking service status (read-only)',
      enabled: true,
    },
    {
      id: 'AE-008',
      type: 'pattern',
      pattern: 'docker\\s+ps',
      description: 'Allow listing running containers (read-only)',
      enabled: true,
    },
    {
      id: 'AE-009',
      type: 'pattern',
      pattern: 'aws\\s+iam\\s+get-',
      description: 'Allow AWS IAM read operations (get-user, get-role, etc.)',
      enabled: true,
    },
    {
      id: 'AE-010',
      type: 'pattern',
      pattern: 'nmap\\s+-sV\\s+localhost',
      description: 'Allow local version scan on localhost only',
      enabled: true,
    },
  ]
}

export class ConfigManager {
  private config: PluginConfig
  private configPath: string
  private rawLlmConfig: Record<string, unknown> | undefined

  constructor(configPath?: string) {
    this.configPath = configPath || this.getDefaultConfigPath()
    this.config = this.loadFromPath(this.configPath)
  }

  getDefaultConfigPath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.'
    const opencodeDir = path.join(homeDir, '.config', 'opencode')
    return path.join(opencodeDir, 'auto-mode.jsonc')
  }

  loadFromPath(configPath: string): PluginConfig {
    try {
      if (!fs.existsSync(configPath)) {
        logWarning(`Config file not found at ${configPath}, using defaults`)
        this.rawLlmConfig = undefined
        const defaultConfig = structuredClone(DEFAULT_CONFIG)
        const defaultRules = loadDefaultBlockRules()
        const defaultExceptions = loadDefaultAllowExceptions()
        defaultConfig.blockRules = defaultRules
        defaultConfig.allowExceptions = defaultExceptions
        return defaultConfig
      }

      const content = fs.readFileSync(configPath, 'utf-8')
      const errors: any[] = []
      const parsed = parse(content, errors, {
        allowTrailingComma: true,
      }) as unknown

      // Capture raw llm config before applying defaults for runtime checks
      const parsedObj =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, unknown>)
          : {}
      this.rawLlmConfig =
        typeof parsedObj.llm === 'object' && parsedObj.llm !== null
          ? (parsedObj.llm as Record<string, unknown>)
          : undefined

      const realErrors = errors.filter((e) => e && typeof e === 'object')
      if (realErrors.length > 0) {
        const errorMessages = realErrors.map((e) => {
          return `Parse error at offset ${e.offset}: code ${e.code}`
        })
        logWarning(
          `JSONC parse errors: ${errorMessages.join(', ')}, using defaults`
        )
        this.rawLlmConfig = undefined
          const defaultConfig = structuredClone(DEFAULT_CONFIG)
        const defaultRules = loadDefaultBlockRules()
        const defaultExceptions = loadDefaultAllowExceptions()
        defaultConfig.blockRules = defaultRules
        defaultConfig.allowExceptions = defaultExceptions
        return defaultConfig
      }

      if (!validateRequiredFields(parsed)) {
        logWarning('Missing required config fields, using defaults')
        const merged = applyDefaults(parsed)
        if (!Array.isArray(parsedObj.excludedAgents)) {
          merged.excludedAgents = [...DEFAULT_CONFIG.excludedAgents]
        }
        const defaultRules = loadDefaultBlockRules()
        const defaultExceptions = loadDefaultAllowExceptions()
        merged.blockRules = defaultRules.concat(
          merged.blockRules as BlockRule[]
        )
        merged.allowExceptions = defaultExceptions.concat(
          merged.allowExceptions as AllowException[]
        )
        return merged
      }

      const merged = applyDefaults(parsed)
      if (!Array.isArray(parsedObj.excludedAgents)) {
        merged.excludedAgents = [...DEFAULT_CONFIG.excludedAgents]
      }
      const defaultRules = loadDefaultBlockRules()
      const defaultExceptions = loadDefaultAllowExceptions()
      merged.blockRules = defaultRules.concat(merged.blockRules as BlockRule[])
      merged.allowExceptions = defaultExceptions.concat(
        merged.allowExceptions as AllowException[]
      )
      logInfo('Configuration loaded successfully')
      return merged
    } catch (error) {
      logError('Error loading config file', error)
      this.rawLlmConfig = undefined
      const defaultConfig = structuredClone(DEFAULT_CONFIG)
      const defaultRules = loadDefaultBlockRules()
      const defaultExceptions = loadDefaultAllowExceptions()
      defaultConfig.blockRules = defaultRules
      defaultConfig.allowExceptions = defaultExceptions
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

  getRawLlmConfig(): Record<string, unknown> | undefined {
    return this.rawLlmConfig
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
            `allowExceptions[${index}]: must be an object with id, pattern, and description`
          )
        } else {
          const e = exc as Record<string, unknown>
          if (typeof e.id === 'undefined' || e.id === null) {
            errors.push(
              `allowExceptions[${index}]: missing required field 'id'`
            )
          }
          if (typeof e.pattern === 'undefined' || e.pattern === null) {
            errors.push(
              `allowExceptions[${index}]: missing required field 'pattern'`
            )
          }
          if (typeof e.description === 'undefined' || e.description === null) {
            errors.push(
              `allowExceptions[${index}]: missing required field 'description'`
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
