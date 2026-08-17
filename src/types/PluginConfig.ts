export type LLMProviderType = 'anthropic' | 'openai' | 'local'
export type DenyMode = 'auto-retry' | 'ask-user' | 'both'
export type FallbackAction = 'ask-user' | 'allow' | 'deny'

export interface LLMProviderConfig {
  provider: LLMProviderType
  model: string
  /** Timeout in milliseconds for LLM API calls. Use -1 for no timeout (infinite). */
  timeout: number
  apiKeysRef: 'opencode-provider-config'
  /** Model name to use when the primary model fails (5xx, rate limit, timeout). Empty string or undefined disables fallback. */
  fallbackModel?: string
  baseUrl: string
  apiKey: string
}

export interface EscalationConfig {
  consecutive: number
  total: number
}

export interface TrustBoundaryConfig {
  protectedPaths: string[]
  protectedCommands: string[]
}

export interface FallbackConfig {
  onTimeout: FallbackAction
  onError: FallbackAction
}

export interface PluginConfig {
  llm: LLMProviderConfig
  denyMode: DenyMode
  escalation: EscalationConfig
  blockRules: unknown[]
  allowExceptions: unknown[]
  trustBoundary: TrustBoundaryConfig
  excludedAgents: string[]
  fallback: FallbackConfig
}

export const DEFAULT_LLM_CONFIG: LLMProviderConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  timeout: 5000, // -1 for no timeout (infinite)
  apiKeysRef: 'opencode-provider-config',
  fallbackModel: '',
  baseUrl: '',
  apiKey: '',
}

export const DEFAULT_FALLBACK_MODEL = 'mistral-large-latest'

export const DEFAULT_ESCALATION_CONFIG: EscalationConfig = {
  consecutive: 3,
  total: 20,
}

export const DEFAULT_TRUST_BOUNDARY: TrustBoundaryConfig = {
  protectedPaths: [
    '/etc/',
    '~/.ssh/',
    '~/.env',
    'C:\\Windows\\',
    '%USERPROFILE%\\.ssh\\',
    '%USERPROFILE%\\.env\\',
  ],
  protectedCommands: [
    'sudo',
    'su',
    'chmod 777',
    'iptables',
    'rm -rf',
    'mkfs',
    'dd if=',
    'fdisk',
  ],
}

export const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  onTimeout: 'ask-user',
  onError: 'ask-user',
}

export const DEFAULT_CONFIG: PluginConfig = {
  llm: DEFAULT_LLM_CONFIG,
  denyMode: 'auto-retry',
  escalation: DEFAULT_ESCALATION_CONFIG,
  blockRules: [],
  allowExceptions: [],
  trustBoundary: DEFAULT_TRUST_BOUNDARY,
  excludedAgents: ['explore', 'research'],
  fallback: DEFAULT_FALLBACK_CONFIG,
}

export function validateRequiredFields(config: unknown): boolean {
  if (!config || typeof config !== 'object') {
    return false
  }
  const c = config as Record<string, unknown>
  if (!c.llm || typeof c.llm !== 'object') {
    return false
  }
  const llm = c.llm as Record<string, unknown>
  if (!llm.provider || typeof llm.provider !== 'string') {
    return false
  }
  if (!llm.model || typeof llm.model !== 'string') {
    return false
  }
  const validProviders: LLMProviderType[] = ['anthropic', 'openai', 'local']
  if (!validProviders.includes(llm.provider as LLMProviderType)) {
    return false
  }
  return true
}

export function applyDefaults(config: unknown): PluginConfig {
  const parsed = (config as Record<string, unknown>) || {}
  const llmDefaults: LLMProviderConfig = {
    ...DEFAULT_LLM_CONFIG,
    fallbackModel:
      typeof parsed.llm === 'object' && parsed.llm !== null
        ? ((parsed.llm as Record<string, unknown>).fallbackModel as string) ||
          ''
        : '',
  }
  return {
    llm: {
      ...DEFAULT_LLM_CONFIG,
      ...((parsed.llm as Record<string, unknown>) || {}),
      fallbackModel: llmDefaults.fallbackModel || '',
    },
    denyMode: (parsed.denyMode as DenyMode) || DEFAULT_CONFIG.denyMode,
    escalation: {
      ...DEFAULT_ESCALATION_CONFIG,
      ...((parsed.escalation as Record<string, unknown>) || {}),
    },
    blockRules: Array.isArray(parsed.blockRules) ? parsed.blockRules : [],
    allowExceptions: Array.isArray(parsed.allowExceptions)
      ? parsed.allowExceptions
      : [],
    trustBoundary: {
      ...DEFAULT_TRUST_BOUNDARY,
      ...((parsed.trustBoundary as Record<string, unknown>) || {}),
    },
    excludedAgents: Array.isArray(parsed.excludedAgents)
      ? parsed.excludedAgents
      : [],
    fallback: {
      ...DEFAULT_FALLBACK_CONFIG,
      ...((parsed.fallback as Record<string, unknown>) || {}),
    },
  }
}
