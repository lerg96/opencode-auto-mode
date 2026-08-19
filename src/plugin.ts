import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { parse } from 'jsonc-parser'
import { ConfigManager } from './config/ConfigManager.js'
import { PatternMatcher } from './rules/PatternMatcher.js'
import { callLlmWithFallback } from './LlmClient.js'
import { RuleEvaluator } from './rules/RuleEvaluator.js'
import { SessionState } from './state/SessionState.js'
import { EscalationService } from './escalation/EscalationService.js'
import { DenyAndContinueService } from './deny-and-continue/DenyAndContinueService.js'
import {
  extractFileFromCommand,
  isSafeFile,
  readSafely,
  isSuspiciousFileContent,
  buildClassifierPrompt as baseBuildClassifierPrompt,
} from './utils/FileExtraction.js'
import { version } from '../package.json'

const HOME = process.env.USERPROFILE || process.env.HOME || ''
const LOG_FILE = path.join(HOME, '.config', 'opencode', 'auto-mode.log')
const MAX_SESSION_TRACKING = 200
const MAX_AGENT_TRACKING = 200

function log(msg: string): void {
  const line = `[AutoMode][v${version}][${new Date().toISOString()}] ${msg}\n`
  fs.promises.appendFile(LOG_FILE, line, { flag: 'a' }).catch(() => {})
}

let configManager: ConfigManager | null = null
let ruleEvaluator: RuleEvaluator | null = null
let client: any = null
let initialized = false
const decisions = new Map<string, { decision: string; reason: string }>()
const agentBySession = new Map<string, string>()
const sessionStates = new Map<string, SessionState>()
let opencodeAllowListByAgent: Map<string, { patterns: string[]; at: string }> =
  new Map()
let configSignature = ''

interface SessionDenialState {
  consecutive: number
  total: number
}

function touchMap<T>(
  map: Map<string, T>,
  key: string,
  value: T,
  cap: number
): void {
  if (map.size >= cap) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.delete(key)
  map.set(key, value)
}

function getSessionState(sessionID: string): SessionState {
  let state = sessionStates.get(sessionID)
  if (!state) {
    state = new SessionState()
    touchMap(sessionStates, sessionID, state, MAX_SESSION_TRACKING)
  } else {
    sessionStates.delete(sessionID)
    sessionStates.set(sessionID, state)
  }
  return state
}

function getDenialState(sessionID: string): SessionDenialState {
  const counters = getSessionState(sessionID).getDenialCounters()
  return { consecutive: counters.consecutive, total: counters.total }
}

function recordDenied(sessionID: string, command = ''): void {
  if (!sessionID) return
  getSessionState(sessionID).incrementDenial(
    {
      toolName: 'Bash',
      arguments: { command },
      context: {
        agentName: agentBySession.get(sessionID) || 'general',
        workingDirectory: '',
        sessionId: sessionID,
      },
    },
    'Denied by auto-mode'
  )
}

function recordApproved(sessionID: string, command = ''): void {
  if (!sessionID) return
  getSessionState(sessionID).incrementAllow(
    {
      toolName: 'Bash',
      arguments: { command },
      context: {
        agentName: agentBySession.get(sessionID) || 'general',
        workingDirectory: '',
        sessionId: sessionID,
      },
    },
    'Approved by auto-mode'
  )
}

function applyDenyMode(
  command: string,
  reason: string,
  blockRule: string,
  config: any,
  sessionID: string
): { decision: string; reason: string } {
  const mode: string = config?.denyMode || 'auto-retry'
  if (mode === 'ask-user') {
    log(`DENY-MODE ask-user: "${logCmd(command)}" -> asking user`)
    return { decision: 'ask', reason: `${reason} — user confirmation required` }
  }
  const service = new DenyAndContinueService(config, getSessionState(sessionID))
  const result = service.handleDeny({
    decision: 'deny',
    reasoning: reason,
    blockRule,
    stage: 'rule-eval',
    timestamp: new Date(),
  })
  log(`DENY-MODE ${mode}: "${logCmd(command)}" -> ${result.type}`)
  if (result.type === 'ask-user') {
    return { decision: 'ask', reason: result.message }
  }
  return { decision: 'deny', reason: result.message }
}

function computeFileSignature(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const errors: any[] = []
    parse(raw, errors, { allowTrailingComma: true })
    const hasErrors = errors.some((e) => e && typeof e === 'object')
    if (hasErrors) {
      log('config parse error — deferring reload')
      return null
    }
    return crypto.createHash('sha1').update(raw).digest('hex')
  } catch (e: any) {
    log(`config signature error: ${e?.message || e}`)
    return null
  }
}

function computeConfigSignature(): string | null {
  return computeFileSignature(getConfigPath())
}

function maybeReloadConfig(): void {
  if (!configManager) return
  const sig = computeConfigSignature()
  if (sig === null || sig === configSignature) return
  configManager.reload(getConfigPath())
  configSignature = sig
  const config = configManager.getConfig()
  log(
    `Config reloaded: rules=${(config.blockRules || []).length} exceptions=${(config.allowExceptions || []).length} llm=${config.llm?.provider || 'none'}`
  )
}

function getConfigDir(): string {
  return (
    process.env.OPENCODE_CONFIG_DIR || path.join(HOME, '.config', 'opencode')
  )
}

function getOpenCodeConfigPath(): string {
  return path.join(getConfigDir(), 'opencode.jsonc')
}

function collectAllowPatterns(perm: any, patterns: string[]): void {
  if (!perm || typeof perm !== 'object') return
  for (const [key, value] of Object.entries(perm)) {
    if (key === '*') continue
    if (typeof value === 'object' && value) {
      for (const [pattern, action] of Object.entries(
        value as Record<string, any>
      )) {
        if (pattern === '*') continue
        if (action === 'allow' || action === true) patterns.push(pattern)
      }
    } else if (value === 'allow' || value === true) {
      patterns.push(key)
    }
  }
}

function loadOpenCodeAllowList(agentName: string): string[] {
  const configPath = getOpenCodeConfigPath()
  try {
    const sig = computeFileSignature(configPath)
    if (sig === null) {
      return opencodeAllowListByAgent.get(agentName)?.patterns || []
    }
    const cached = opencodeAllowListByAgent.get(agentName)
    if (cached && sig === cached.at) return cached.patterns
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = parse(raw)
    const patterns: string[] = []
    collectAllowPatterns(parsed?.permission, patterns)
    collectAllowPatterns(parsed?.agent?.[agentName]?.permission, patterns)
    const unique = [...new Set(patterns)]
    touchMap(
      opencodeAllowListByAgent,
      agentName,
      { patterns: unique, at: sig },
      MAX_AGENT_TRACKING
    )
    log(
      `allow-list loaded: ${unique.length} patterns (agent=${agentName}) [${unique.slice(0, 12).join(', ')}${unique.length > 12 ? ', ...' : ''}]`
    )
    return unique
  } catch (e: any) {
    log(`allow-list load error: ${e?.message || e}`)
    return []
  }
}

const globPatternToRegex = (pattern: string): string => {
  let out = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*') {
      out += '.*'
      i++
    } else if (ch === '?') {
      out += '.'
      i++
    } else if (ch === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close === -1) {
        out += '\\['
        i++
        continue
      }
      let inner = pattern.slice(i + 1, close)
      if (inner.startsWith('!')) {
        inner = '^' + inner.slice(1)
      }
      inner = inner.replace(/\\/g, '\\\\')
      out += `[${inner}]`
      i = close + 1
    } else if (ch === '{') {
      const close = pattern.indexOf('}', i + 1)
      if (close === -1) {
        out += '\\{'
        i++
        continue
      }
      const parts = pattern.slice(i + 1, close).split(',')
      out += `(?:${parts
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')})`
      i = close + 1
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      i++
    }
  }
  return out
}

const patternToRegex = (pattern: string): RegExp => {
  return new RegExp(`^${globPatternToRegex(pattern)}$`, 'i')
}

let softRulesCache: string[] | null = null
let softRulesSignature = ''

function loadSoftRules(): string[] {
  try {
    const sig = computeConfigSignature()
    if (sig === null) return softRulesCache || []
    if (softRulesCache && sig === softRulesSignature) return softRulesCache
    const raw = fs.readFileSync(getConfigPath(), 'utf8')
    const parsed = parse(raw)
    const rules = Array.isArray(parsed?.softRules) ? parsed.softRules : []
    softRulesCache = rules
    softRulesSignature = sig
    log(`softRules loaded: ${rules.length} rule(s) [${rules.join(', ')}]`)
    return rules
  } catch {
    return softRulesCache || []
  }
}

function isOpenCodeAllowed(command: string, sessionID: string): boolean {
  const agentName = agentBySession.get(sessionID) || 'general'
  for (const pattern of loadOpenCodeAllowList(agentName)) {
    try {
      if (patternToRegex(pattern).test(command)) return true
    } catch {}
  }
  return false
}

const SECRET_FILE_PATTERN =
  /(\.env(\.\w+)?|\bcredentials\b|\.ssh|id_(rsa|ed25519|dsa|ecdsa)|\.netrc|\.npmrc|\.aws|\.kube|\.pypirc|\.gitconfig)/i
const SECRET_KEYWORD_PATTERN =
  /(api[_-]?keys?|\bsecrets?\b|\btokens?\b|\bpasswords?\b)/i
const SECRET_CMD_PATTERN = /getent\s+(passwd|shadow|group)/i

const SHELL_SEPARATOR_RE = /[;|`\n]|\$\s*\(|<\(|(?<![<>\d])&(?![>])/

function isSimpleCommand(command: string): boolean {
  return !SHELL_SEPARATOR_RE.test(command) && !/\beval\b/.test(command)
}

function deobfuscateCommand(command: string): string {
  return command.replace(/["'\\]/g, '')
}

function matchesSecretPattern(re: RegExp, text: string): boolean {
  re.lastIndex = 0
  return re.test(text)
}

function stripVariableExpansion(text: string): string {
  return text.replace(/\$\{[^}]*\}/g, '').replace(/\$[A-Za-z_][\w]*/g, '')
}

const SECRET_ASSIGNMENT_RE =
  /\b(api[_-]?key|secret|token|password|passwd|pwd|credential|auth|client[_-]?secret|access[_-]?key|aws[_-]?(?:secret[_-]?access[_-]?key|access[_-]?key))\b\s*[=:]\s*[^\s"';&|`$]+/gi
const SECRET_FLAG_RE =
  /(--[\w-]*(?:key|token|secret|password|credential|auth|pwd))(\s*[=:]\s*|\s+)[^\s"';&|`$]+/gi
const SECRET_VAR_REF_RE = /(\$|\$\{)[A-Za-z_]*(?:api[_-]?key|secret|token|password|passwd|credential|auth|client[_-]?secret|access[_-]?key)[\w}]*\b/gi
const BEARER_RE = /(Authorization\s*:\s*Bearer\s+)[^\s"';&|`$]+/gi
const URL_CRED_RE = /(\bhttps?:\/\/)[^\/\s:@]+:[^\/\s:@]+@/gi

function redact(text: string): string {
  if (!text) return text
  return text
    .replace(BEARER_RE, '$1***REDACTED***')
    .replace(URL_CRED_RE, '$1***REDACTED***@')
    .replace(SECRET_ASSIGNMENT_RE, '$1=***REDACTED***')
    .replace(SECRET_FLAG_RE, '$1***REDACTED***')
}

function logCmd(text: string, length = 80): string {
  return redact(String(text)).slice(0, length)
}

function isSecretSensitive(command: string): boolean {
  const deobf = deobfuscateCommand(command)
  const stripped = stripVariableExpansion(deobf)
  const rawNoVar = stripVariableExpansion(command)
  const forms = [command, deobf, stripped, rawNoVar].filter(
    (v, i, a) => a.indexOf(v) === i
  )
  const isVarMatch = forms.some((c) => matchesSecretPattern(SECRET_VAR_REF_RE, c))
  return forms.some(
    (c) =>
      matchesSecretPattern(SECRET_FILE_PATTERN, c) ||
      matchesSecretPattern(SECRET_KEYWORD_PATTERN, c) ||
      matchesSecretPattern(SECRET_ASSIGNMENT_RE, c) ||
      matchesSecretPattern(SECRET_FLAG_RE, c) ||
      matchesSecretPattern(BEARER_RE, c) ||
      matchesSecretPattern(URL_CRED_RE, c) ||
      matchesSecretPattern(SECRET_CMD_PATTERN, c)
  ) || isVarMatch
}

function allowListed(command: string, sessionID: string): boolean {
  return isSimpleCommand(command) && isOpenCodeAllowed(command, sessionID)
}

export {
  extractFileFromCommand,
  isSafeFile,
  readSafely,
  isSuspiciousFileContent,
  parseDecision,
  redact,
  logCmd,
  isSecretSensitive,
  isSimpleCommand,
  normalizePatterns,
  normalizeRules,
  allowListed,
  patternToRegex,
  loadOpenCodeAllowList,
  getDenialState,
  recordDenied,
  recordApproved,
  getSessionTrackingSize,
  classifyCommand,
}

function getSessionTrackingSize(): {
  sessions: number
  agents: number
} {
  return {
    sessions: sessionStates.size,
    agents: agentBySession.size,
  }
}

export { callLlmWithFallback } from './LlmClient.js'
const buildClassifierPrompt = baseBuildClassifierPrompt

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

const REGEX_METACHAR_RE = /[\\()|+{}^$\[\]?]/

function globToRegex(glob: string): string {
  let out = ''
  for (const ch of glob) {
    if (ch === '*') {
      out += '.*'
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return out
}

function normalizePatterns(rules: any[], label: string): any[] {
  return (rules || []).map((r) => {
    if (r && r.type === 'pattern' && typeof r.pattern === 'string') {
      if (r.pattern.startsWith('regex:')) {
        const body = r.pattern.slice(6)
        if (!isValidRegex(body)) {
          log(
            `WARN: ${label} ${r.id} has invalid regex "${body}" — treated as substring match`
          )
          return { ...r, pattern: body }
        }
        return r
      }
      if (r.pattern.includes('*') && !REGEX_METACHAR_RE.test(r.pattern)) {
        return { ...r, pattern: `regex:${globToRegex(r.pattern)}` }
      }
      if (REGEX_METACHAR_RE.test(r.pattern)) {
        if (isValidRegex(r.pattern)) {
          return { ...r, pattern: `regex:${r.pattern}` }
        }
        log(
          `WARN: ${label} ${r.id} contains regex metacharacters but is not a valid regex ("${r.pattern}") — treated as substring match`
        )
      }
    }
    return r
  })
}

function normalizeRules(rules: any[], softRules?: string[]): any[] {
  const soft = new Set(softRules || [])
  return normalizePatterns(rules, 'blockRule').map((r) => {
    if (r && soft.has(r.id)) {
      r = { ...r, severity: 'soft' }
    }
    return r
  })
}

function getConfigPath(): string {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return path.join(process.env.OPENCODE_CONFIG_DIR, 'auto-mode.jsonc')
  }
  return path.join(HOME, '.config', 'opencode', 'auto-mode.jsonc')
}

function getConfig(): any {
  return configManager ? configManager.getConfig() : {}
}

async function callLLMWithFallback(
  model: string,
  fallbackModel: string,
  prompt: string
): Promise<string> {
  const llm = getConfig().llm || {}
  const baseUrl = llm.baseUrl || 'http://localhost:18780/v1'
  const apiKey = llm.apiKey || ''
  const timeoutMs = llm.timeout || 8000

  const result = await callLlmWithFallback({
    baseUrl,
    apiKey,
    model,
    fallbackModel,
    prompt,
    timeoutMs,
  })
  if (result.usedFallback) {
    log(`LLM fallback: ${fallbackModel} (reason: ${result.fallbackError})`)
  }
  return result.content
}

async function callLLM(prompt: string): Promise<string> {
  const llm = getConfig().llm || {}
  const rawLlm = configManager?.getRawLlmConfig()

  const model = llm.model
  const hasModelConfigured =
    typeof rawLlm?.model === 'string' && rawLlm.model.length > 0
  const hasFallbackConfigured =
    typeof rawLlm?.fallbackModel === 'string' && rawLlm.fallbackModel.length > 0

  if (!hasModelConfigured) {
    log('LLM model not configured in user config, skipping LLM classification')
    throw new Error('LLM model not configured')
  }
  if (!hasFallbackConfigured) {
    const result = await callLlmWithFallback({
      baseUrl: llm.baseUrl || 'http://localhost:18780/v1',
      apiKey: llm.apiKey || '',
      model,
      fallbackModel: '',
      prompt,
      timeoutMs: llm.timeout || 8000,
    })
    return result.content
  }

  const fallbackModel =
    typeof rawLlm.fallbackModel === 'string' ? rawLlm.fallbackModel : ''
  return callLLMWithFallback(model, fallbackModel, prompt)
}

let llmQueue: Promise<any> = Promise.resolve()
function callLLMSerialized(prompt: string): Promise<string> {
  const task = llmQueue.then(() => callLLM(prompt))
  llmQueue = task.catch(() => {})
  return task
}

function parseDecision(text: string): { decision: string; reason: string } {
  try {
    // Strip all code fence patterns: ```json ... ```, ```python ... ```, ``` ... ```
    const cleaned = text.replace(/```\w*\s*([\s\S]*?)\s*```/g, '$1').trim()
    const json = JSON.parse(cleaned)
    if (typeof json.allow === 'boolean') {
      return {
        decision: json.allow ? 'allow' : 'deny',
        reason: String(json.reason || '').slice(0, 200),
      }
    }
  } catch {
    log(
      `Parse failed, raw: ${redact(String(text))
        .slice(0, 300)
        .replace(/\n/g, '\\n')}`
    )
  }
  return { decision: 'ask', reason: 'Unparseable LLM response' }
}

async function classifyCommand(
  command: string,
  sessionID: string
): Promise<{ decision: string; reason: string }> {
  maybeReloadConfig()
  const config = getConfig()

  if (isSecretSensitive(command)) {
    log(
      `SECRET-GUARD: "${logCmd(command)}" -> asking user (secret path/keywords)`
    )
    return {
      decision: 'ask',
      reason: 'Secret keyword detected in command — user confirmation required',
    }
  }

  const toolCall: any = {
    toolName: 'Bash',
    arguments: { command },
    context: {
      agentName: agentBySession.get(sessionID) || 'general',
      sessionId: sessionID,
    },
  }

  const normalizedRules = normalizeRules(config.blockRules, loadSoftRules())
  const normalizedExceptions = normalizePatterns(
    config.allowExceptions || [],
    'allowException'
  )
  const ruleResult = (ruleEvaluator as any).evaluate(
    toolCall,
    normalizedRules,
    normalizedExceptions,
    config.trustBoundary
  )

  if (ruleResult.evaluation === 'blocked') {
    const ruleId = ruleResult.matchedRule || 'matched'
    const rule = (normalizedRules || []).find((r: any) => r.id === ruleId)
    const severity = ruleId.startsWith('TB-')
      ? 'critical'
      : rule?.severity || 'high'
    const reason = `Rule ${ruleId} blocked command`
    if (severity === 'critical') {
      log(`RULES deny: "${logCmd(command)}" (${reason})`)
      return applyDenyMode(command, reason, ruleId, config, sessionID)
    }
    if (allowListed(command, sessionID)) {
      log(`ALLOW-LIST skip: "${logCmd(command)}"`)
      return { decision: 'allow', reason: 'opencode permission allow-list' }
    }
    if (severity === 'soft') {
      log(`RULES soft: "${logCmd(command)}" (${reason}) -> LLM classification`)
    } else {
      log(`RULES ask: "${logCmd(command)}" (${reason})`)
      return {
        decision: 'ask',
        reason: `${reason} — user confirmation required`,
      }
    }
  } else if (ruleResult.evaluation === 'allowed') {
    if (!isSimpleCommand(command)) {
      log(
        `RULES exception matched compound command: "${logCmd(command)}" (${ruleResult.matchedException || 'exception'}) -> ask`
      )
      return {
        decision: 'ask',
        reason:
          'Allow exception matched a compound command — user confirmation required',
      }
    }
    log(
      `RULES allow: "${logCmd(command)}" (${ruleResult.matchedException || 'exception'})`
    )
    return { decision: 'allow', reason: 'Allowed by exception' }
  }

  if (allowListed(command, sessionID)) {
    log(`ALLOW-LIST skip: "${logCmd(command)}"`)
    return { decision: 'allow', reason: 'opencode permission allow-list' }
  }
  if (ruleResult.evaluation === 'uncertain') {
    log(
      `RULES uncertain: "${logCmd(command)}" — ${ruleResult.matchedException || ruleResult.matchedRule || 'no match'} — proceeding to LLM classification`
    )
  }

  const llm = config.llm || {}
  if (llm.enabled === false) {
    return { decision: 'ask', reason: 'LLM classification disabled' }
  }

  const rawLlm = configManager?.getRawLlmConfig()
  if (typeof rawLlm?.model !== 'string' || rawLlm.model.length === 0) {
    return {
      decision: 'ask',
      reason: 'LLM model not configured — user confirmation required',
    }
  }

  try {
    const filePath = extractFileFromCommand(command)
    let fileContent: string | null = null
    if (filePath) {
      fileContent = readSafely(filePath, config.trustBoundary)
      if (fileContent && isSuspiciousFileContent(fileContent)) {
        log(
          `SUSPICIOUS FILE DETECTED: "${filePath}" — potential security risk, flagging for LLM review`
        )
      }
    }
    const text = await callLLMSerialized(
      buildClassifierPrompt(command, filePath, fileContent)
    )
    const result = parseDecision(text)
    log(
      `LLM classify: "${logCmd(command)}" (file=${filePath || 'none'}) -> ${result.decision} (${redact(result.reason)})`
    )
    return result
  } catch (e: any) {
    const errMsg = redact(String(e?.message || e))
    log(`LLM classify error: ${errMsg}`)
    const fallback = config.fallback || {}
    const isTimeout = /timeout|timed out/i.test(String(e?.message || e))
    const mode = isTimeout ? fallback.onTimeout : fallback.onError
    const fallbackDecision = mode || 'ask-user'
    if (fallbackDecision === 'allow')
      return { decision: 'allow', reason: 'LLM error, fallback allow' }
    if (fallbackDecision === 'deny')
      return { decision: 'deny', reason: 'LLM error, fallback deny' }
    return {
      decision: 'ask',
      reason: isTimeout ? 'LLM timeout' : 'LLM unavailable',
    }
  }
}

async function replyPermission(
  sessionID: string,
  permissionID: string,
  response: string
): Promise<void> {
  if (!client) return
  try {
    await client.postSessionIdPermissionsPermissionId({
      path: { id: sessionID, permissionID },
      body: { response },
    })
    log(`Permission reply: ${sessionID} ${permissionID} -> ${response}`)
  } catch (e: any) {
    log(`Permission reply error: ${e?.message || e}`)
  }
}

export const opencodeAutoMode = async (
  ctx: any
): Promise<Record<string, any>> => {
  if (initialized) return {}
  initialized = true
  log('PLUGIN INITIALIZED')
  try {
    client = ctx?.client
    configManager = new ConfigManager(getConfigPath())
    configManager.load()
    configSignature = computeConfigSignature() || ''
    ruleEvaluator = new RuleEvaluator(new PatternMatcher() as any)
    const config = configManager.getConfig()
    log(
      `Config loaded: rules=${(config.blockRules || []).length} exceptions=${(config.allowExceptions || []).length} llm=${config.llm?.provider || 'none'}`
    )
  } catch (e: any) {
    log(`INIT FAILED: ${e?.message || e}`)
    return {}
  }

  return {
    'tool.execute.before': async (input: any, output: any) => {
      try {
        if (!input || input.tool !== 'bash') return
        const command = output?.args?.command
        if (!command || typeof command !== 'string' || command.length === 0)
          return
        if (command.startsWith('# BLOCKED') && !command.includes('\n')) return
        log(`tool.execute.before: ${input.callID} "${logCmd(command, 100)}"`)

        const sessionID = input.sessionID || ''
        const result = await classifyCommand(command, sessionID)
        if (result.decision === 'deny') {
          recordDenied(sessionID, command)
        } else if (result.decision === 'allow') {
          recordApproved(sessionID, command)
        }
        decisions.set(input.callID, result)
        if (decisions.size > 200) {
          const firstKey = decisions.keys().next().value
          if (firstKey) decisions.delete(firstKey)
        }
      } catch (e: any) {
        log(`tool.execute.before error: ${e?.message || e}`)
      }
    },

    event: async (input: any) => {
      try {
        const evt = input?.event
        if (!evt || !evt.type) return

        if (evt.type === 'session.created') {
          const info = evt.properties?.info
          if (info?.id && info?.agent) {
            touchMap(agentBySession, info.id, info.agent, MAX_AGENT_TRACKING)
          }
          if (info?.id) sessionStates.delete(info.id)
          log(`session.created: agent=${info?.agent} session=${info?.id}`)
        }

        if (evt.type === 'session.deleted') {
          const info = evt.properties?.info
          if (info?.id) {
            sessionStates.delete(info.id)
            agentBySession.delete(info.id)
            log(`session.deleted: session=${info?.id}`)
          }
        }

        if (evt.type === 'permission.asked') {
          const props = evt.properties || {}
          const sessionID = props.sessionID
          const permissionID = props.id
          const command = props.metadata?.command || ''
          const callID = props.tool?.callID
          log(
            `permission.asked: ${permissionID} callID=${callID} "${logCmd(command, 100)}"`
          )

          const config = getConfig()

          let result = callID ? decisions.get(callID) : undefined
          const reclassified = !result && command
          if (reclassified) {
            result = await classifyCommand(command, sessionID)
          }
          if (callID) decisions.delete(callID)

          if (!result || result.decision === 'ask') {
            log(`permission.asked: asking user (no auto decision)`)
            return
          }

          if (reclassified && sessionID) {
            if (result.decision === 'deny') {
              recordDenied(sessionID, command)
            } else if (result.decision === 'allow') {
              recordApproved(sessionID, command)
            }
          }

          if (result.decision === 'deny' && sessionID) {
            const escalationService = new EscalationService(
              getSessionState(sessionID),
              config
            )
            if (escalationService.checkThresholds().escalated) {
              log(`permission.asked: escalation threshold reached, asking user`)
              return
            }
          }

          if (result.decision === 'allow') {
            await replyPermission(sessionID, permissionID, 'once')
          } else if (result.decision === 'deny') {
            await replyPermission(sessionID, permissionID, 'reject')
          }
        }
      } catch (e: any) {
        log(`event hook error: ${e?.message || e}`)
      }
    },
  }
}

export default opencodeAutoMode
