import * as path from 'node:path'
import * as fs from 'node:fs'

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

export function extractFileFromCommand(command: string): string | null {
  if (isInlineCode(command)) return null
  return findFileInCommand(command)
}

function isInlineCode(cmd: string): boolean {
  for (const pat of INLINE_CODE_PATTERNS) {
    if (cmd.includes(pat)) return true
  }
  return false
}

function findFileInCommand(cmd: string): string | null {
  const words = cmd.split(/[\s|;&]+/).filter((w) => w.length > 0)
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i]
    const stripped = word.replace(/^["']+|["']+$/g, '')
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

export function isSafeFile(filepath: string): boolean {
  const basename = path.basename(filepath)
  if (basename.startsWith('.')) return false
  if (!fs.existsSync(filepath)) return true
  if (fs.statSync(filepath).isDirectory()) return false
  const resolved = fs.realpathSync(filepath)
  const parent = resolved.replace(new RegExp('[\\\\/][^\\\\/]+$'), '')
  const unsafeSegments = [
    '.ssh',
    '.git',
    '.aws',
    '.config',
    '.local',
    'credentials',
    'password',
    'secret',
    'token',
    'env',
    'node_modules',
    '.npm',
    '.yarn',
    '.pnp',
  ]
  for (const seg of unsafeSegments) {
    if (parent.includes(seg)) return false
  }
  return true
}

export function readSafely(filepath: string): string | null {
  if (!filepath || !isSafeFile(filepath)) return null
  try {
    const content = fs.readFileSync(filepath, 'utf-8')
    if (!content || typeof content !== 'string') return null
    return content.slice(0, SAFE_FILE_SIZE_BYTES).trim() || null
  } catch {
    return null
  }
}

export function isSuspiciousFileContent(content: string): boolean {
  const suspiciousPatterns = [
    'eval\\(',
    'exec\\(',
    'execSync\\(',
    'child_process',
    'require\\([\'"]child_process',
    'import\\s+child_process',
    'fetch\\(',
    'axios',
    'https?',
    'http\\.',
    'request\\(',
    'Buffer\\.',
    'atob\\(',
    'btoa\\(',
    'unserialize',
    'marshal',
    'chmod\\(',
    'chown\\(',
    'umask\\(',
    'mktemp',
    'mkdtemp',
    'subprocess\\.Popen',
    'subprocess\\.run',
    'subprocess\\.call',
    'exec\\.bash',
    'shutil\\.',
    'os\\.system',
    'os\\.popen',
    'os\\.remove',
    'os\\.unlink',
    'os\\.rename',
    'process\\.exit',
    'process\\.kill',
    'System\\.loadLibrary',
    'Runtime\\.getRuntime',
    'ProcessBuilder',
    'PowerShell',
    'Start-Process',
  ]
  for (const pattern of suspiciousPatterns) {
    if (new RegExp(pattern, 'i').test(content)) return true
  }
  return false
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
