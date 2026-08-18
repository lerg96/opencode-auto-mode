import * as path from 'node:path'
import * as fs from 'node:fs'
import { DEFAULT_TRUST_BOUNDARY } from '../types/PluginConfig'
import type { TrustBoundaryConfig } from '../types/PluginConfig'

const INLINE_CODE_PATTERNS = [
  '-c "',
  "-c '",
  '-e "',
  "-e '",
  '--eval "',
  "--eval '",
]

export function isInlineCommand(cmd: string): boolean {
  for (const pat of INLINE_CODE_PATTERNS) {
    if (cmd.includes(pat)) return true
  }
  return false
}

export const SAFE_FILE_SIZE_BYTES = 8000
export const SAFE_FILE_EXTENSIONS = new Set([
  'js',
  'ts',
  'jsx',
  'tsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'java',
  'cs',
  'go',
  'rs',
  'kt',
  'php',
  'swift',
  'c',
  'cpp',
  'h',
  'hpp',
  'r',
  'jl',
  'dart',
  'scala',
  'lua',
  'pl',
  'pm',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'psm1',
  'vue',
  'svelte',
  'html',
  'css',
  'scss',
  'sass',
  'less',
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'md',
  'txt',
  'log',
  'xml',
  'proto',
])

const HOME = process.env.USERPROFILE || process.env.HOME || ''

const INTERPRETER_RE =
  /^(?:python(?:3(?:\.\d+)?)?|pypy3?|node|nodejs|deno|bun|ruby|php|perl|bash|sh|zsh|pwsh|powershell|tsx|npx|lua|luajit|julia|Rscript|dart|kotlin|groovy|scala|go|java|javac|rustc|cargo|npm|yarn|pnpm)$/i

const FLAG_VALUE_RE = /^-{1,2}(?:m|message|c|e|eval)$/

const REDIRECT_OPERATOR_RE = /^[\d&]*>+[\d&]*$/

export function extractFileFromCommand(command: string): string | null {
  if (isInlineCommand(command)) return null
  return findFileInCommand(command)
}

function tokenizeShell(cmd: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]

    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (quote === '"') {
      if (
        ch === '\\' &&
        (cmd[i + 1] === '"' || cmd[i + 1] === '$' || cmd[i + 1] === '`')
      ) {
        escaped = true
      } else if (ch === '"') {
        quote = null
      } else {
        current += ch
      }
      continue
    }

    if (quote === "'") {
      if (ch === "'") {
        quote = null
      } else {
        current += ch
      }
      continue
    }

    if (ch === '\\') {
      const next = cmd[i + 1]
      if (next !== undefined && /[\s"'$`\\|;&]/.test(next)) {
        escaped = true
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"') {
      quote = '"'
      continue
    }

    if (ch === "'") {
      quote = "'"
      continue
    }

    if (/[\s|;&]/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (current.length > 0) {
    tokens.push(current)
  }
  return tokens
}

function findFileInCommand(cmd: string): string | null {
  const tokens = tokenizeShell(cmd)
  if (tokens.length === 0) return null

  const startIdx = INTERPRETER_RE.test(tokens[0]) ? 1 : 0
  let skipNext = false

  for (let i = startIdx; i < tokens.length; i++) {
    const token = tokens[i]

    if (skipNext) {
      skipNext = false
      continue
    }

    if (REDIRECT_OPERATOR_RE.test(token)) {
      skipNext = true
      continue
    }

    if (token.includes('>')) {
      continue
    }

    if (FLAG_VALUE_RE.test(token)) {
      skipNext = true
      continue
    }

    if (token.startsWith('-') && token.length > 1) {
      continue
    }

    const stripped = token.replace(/^["']+|["']+$/g, '')
    const filePattern = /\.[a-zA-Z][\w]*$/
    if (!filePattern.test(stripped)) continue
    const dotIdx = stripped.lastIndexOf('.')
    if (dotIdx <= 0) continue
    const ext = stripped.slice(dotIdx + 1).toLowerCase()
    if (!SAFE_FILE_EXTENSIONS.has(ext)) continue
    return stripped
  }

  return null
}

const UNSAFE_SEGMENTS = new Set([
  '.ssh',
  '.git',
  '.aws',
  '.config',
  '.local',
  '.env',
  'credentials',
  'password',
  'secret',
  'token',
  'env',
  'node_modules',
  '.npm',
  '.yarn',
  '.pnp',
])

const CREDENTIAL_BASENAME_RE =
  /\b(?:passwords?|passwds?|secrets?|tokens?|credentials?|api[-_]?keys?|private[-_]?keys?|keys?)\b/i

export function isSafeFile(
  filepath: string,
  trustBoundary?: TrustBoundaryConfig
): boolean {
  if (!filepath) return false
  const basename = path.basename(filepath)
  if (basename.startsWith('.')) return false
  try {
    if (!fs.existsSync(filepath)) return true
    if (fs.statSync(filepath).isDirectory()) return false
    const resolved = fs.realpathSync(filepath)
    if (!isWithinTrustBoundary(resolved, trustBoundary)) return false

    const parent = path.dirname(resolved)
    const segments = parent.split(/[\\/]+/).filter((s) => s.length > 0)
    for (const seg of segments) {
      if (UNSAFE_SEGMENTS.has(seg)) return false
    }

    if (CREDENTIAL_BASENAME_RE.test(basename)) return false
    return true
  } catch {
    return false
  }
}

function expandHome(p: string): string {
  return p.replace(/^~(?=[\\/])/, HOME).replace(/%USERPROFILE%/g, HOME)
}

function isWithinTrustBoundary(
  resolved: string,
  trustBoundary?: TrustBoundaryConfig
): boolean {
  const tb = trustBoundary || DEFAULT_TRUST_BOUNDARY
  const protectedPaths =
    tb && Array.isArray(tb.protectedPaths) ? tb.protectedPaths : []
  const normalized = path.normalize(resolved).toLowerCase()
  const sep = path.sep

  for (const p of protectedPaths) {
    if (typeof p !== 'string' || p.length === 0) continue
    const expanded = expandHome(p)
    if (expanded.length === 0) continue
    const norm = path.normalize(expanded).toLowerCase()
    if (norm.endsWith('/') || norm.endsWith('\\') || norm.endsWith(sep)) {
      if (normalized.startsWith(norm)) return false
    } else if (normalized === norm || normalized.startsWith(norm + sep)) {
      return false
    }
  }

  return true
}

export function readSafely(
  filepath: string,
  trustBoundary?: TrustBoundaryConfig
): string | null {
  if (!filepath) return null
  let fd: number | null = null
  try {
    if (!isSafeFile(filepath, trustBoundary)) return null
    fd = fs.openSync(filepath, 'r')
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) return null
    if (stat.size === 0) return null
    const readLength = Math.min(stat.size, SAFE_FILE_SIZE_BYTES)
    const buffer = Buffer.alloc(readLength)
    fs.readSync(fd, buffer, 0, readLength, 0)
    const content = buffer.toString('utf-8')
    return content.slice(0, SAFE_FILE_SIZE_BYTES).trim() || null
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {}
    }
  }
}

const SUSPICIOUS_STRONG_PATTERNS: RegExp[] = [
  /\beval\s*\(/i,
  /\bexec(?:Sync)?\s*\(/i,
  /child_process/i,
  /fetch\s*\(\s*['"`]?https?:\/\//i,
  /axios\.\w+\s*\(/i,
  /(?:http|https)\.request\s*\(/i,
  /Buffer\.(?:from|alloc|concat)\s*\(/i,
  /\batob\s*\(/i,
  /\bbtoa\s*\(/i,
  /\bunserialize\b/i,
  /\bmarshal\b/i,
  /\bchmod\s*\(/i,
  /\bchown\s*\(/i,
  /\bumask\s*\(/i,
  /\bmktemp\b/i,
  /\bmkdtemp\b/i,
  /subprocess\.(?:Popen|run|call|check_output)\s*\(/i,
  /exec\.bash\b/i,
  /shutil\.\w+\s*\(/i,
  /os\.(?:system|popen|remove|unlink|rename)\s*\(/i,
  /process\.(?:exit|kill)\s*\(/i,
  /System\.loadLibrary\s*\(/i,
  /Runtime\.getRuntime\s*\(/i,
  /\bProcessBuilder\b/i,
  /\bPowerShell\b/i,
  /Start-Process\b/i,
]

const SUSPICIOUS_WEAK_PATTERNS: RegExp[] = [
  /https?:\/\//i,
  /\bBuffer\b/i,
  /\baxios\b/i,
]

export function isSuspiciousFileContent(content: string): boolean {
  if (!content || typeof content !== 'string') return false
  for (const re of SUSPICIOUS_STRONG_PATTERNS) {
    if (re.test(content)) return true
  }
  let weakHits = 0
  for (const re of SUSPICIOUS_WEAK_PATTERNS) {
    if (re.test(content)) weakHits++
  }
  return weakHits >= 2
}

export function buildClassifierPrompt(
  command: string,
  filePath: string | null,
  fileContent: string | null
): string {
  const lines: string[] = [
    'You are a security classifier for an AI coding assistant. Decide whether the following shell command is SAFE to execute automatically WITHOUT user confirmation.',
    '',
    'Block commands that:',
    '- Delete/destroy data (rm -rf, drop database, format disk)',
    '- Change system security (chmod 777, sudo, su, iptables, firewall settings — including ENABLING or DISABLING firewalls via netsh advfirewall / Set-NetFirewall*, user accounts, privileges)',
    '- Access protected locations (~/.ssh, ~/.env, /etc, credentials)',
    '- Exfiltrate secrets or data (curl/wget + token/key/credential content)',
    '- Install/execute arbitrary remote code or malware',
    '- Modify user accounts, passwords, or privileges',
    '- Scan networks or hosts for attacks (nmap, nikto, metasploit)',
    '- Overwrite critical system files',
    '',
    'ALLOW commands that are read-only, informational, build/test related, git operations, file listing/reading, or any benign development activity.',
    'Inline interpreter commands (python -c, node -e, node --eval, bash -c, pwsh -Command, cmd /c) are ALLOWED when they perform READ-ONLY operations: reading files, parsing JSON/text, math, string transformation, listing directories.',
    'DENY inline interpreters when they write/modify/delete files, spawn or execute other processes, run shell commands, install packages, or change system state.',
  ]

  if (filePath && fileContent) {
    lines.push('')
    lines.push(
      `FILE CONTEXT: The agent is trying to execute the following file "${filePath}" via this command.`
    )
    lines.push(
      'Review the file contents and validate all security rules carefully:'
    )
    lines.push('---')
    lines.push(fileContent)
    lines.push('---')
    lines.push(
      'CHECK the file for: obfuscated code, network calls, system command execution, file modification, credential access, dangerous module imports.'
    )
  }

  lines.push('')
  lines.push(`Command to classify:\n${command}`)
  lines.push('')
  lines.push(
    'Reply with ONLY valid JSON: {"allow": true or false, "reason": "short explanation"}'
  )

  return lines.join('\n')
}
