export const SECRET_ASSIGNMENT_RE =
  /\b(api[_-]?key|secret|token|password|passwd|pwd|credential|auth|client[_-]?secret|access[_-]?key|aws[_-]?(?:secret[_-]?access[_-]?key|access[_-]?key(?:[_ ]*ID)?))\b\s*[=:]\s*[^\s"';&|`$]+/gi
export const SECRET_FLAG_RE =
  /(--[\w-]*(?:key|token|secret|password|credential|auth|pwd))(\s*[=:]\s*|\s+)[^\s"';&|`$]+/gi
export const BEARER_RE = /(Authorization\s*:\s*Bearer\s+)[^\s"';&|`$]+/gi
export const URL_CRED_RE = /(\bhttps?:\/\/)[^\/\s:@]+:[^\/\s:@]+@/gi

export function redact(text: string): string {
  if (!text) return text
  return text
    .replace(BEARER_RE, '$1***REDACTED***')
    .replace(URL_CRED_RE, '$1***REDACTED***@')
    .replace(SECRET_ASSIGNMENT_RE, '$1=***REDACTED***')
    .replace(SECRET_FLAG_RE, '$1***REDACTED***')
}