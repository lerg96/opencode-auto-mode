// Value accepts quoted strings (JSON `"password":"x"`, `--password "x"`) and
// bare tokens. The keyword boundary uses (?<![A-Za-z0-9]) / (?![A-Za-z0-9])
// instead of \b so keywords preceded by "_" (GITHUB_TOKEN, MY_SECRET,
// STRIPE_API_KEY) are still caught: "_" is a word char, so \b silently missed
// every *_TOKEN / *_SECRET / *_API_KEY / *_PASSWORD form. The optional `"?`
// after the keyword accepts the closing quote in JSON `"key": "value"`.
export const SECRET_ASSIGNMENT_RE =
  /(?<![A-Za-z0-9])(api[_-]?key|secret|token|password|passwd|pwd|credential|auth|client[_-]?secret|access[_-]?key|aws[_-]?(?:secret[_-]?access[_-]?key|access[_-]?key(?:[_ ]*ID)?))(?![A-Za-z0-9])"?\s*[=:]\s*("[^"]*"|'[^']*'|[^\s"';&|`$]+)/gi
export const SECRET_FLAG_RE =
  /(--[\w-]*(?:key|token|secret|password|credential|auth|pwd))(\s*[=:]\s*|\s+)("[^"]*"|'[^']*'|[^\s"';&|`$]+)/gi
export const BEARER_RE = /(Authorization\s*:\s*Bearer\s+)[^\s"';&|`$]+/gi
// Scheme-agnostic: also covers postgres://, mysql://, mongodb://, jdbc:mysql://,
// redis:// connection strings, not just http(s)://.
export const URL_CRED_RE =
  /([A-Za-z][\w+.-]*(?::[\w+.-]+)?:\/\/)[^\/\s:@]+:[^\/\s:@]+@/gi

export function redact(text: string): string {
  if (!text) return text
  return text
    .replace(BEARER_RE, '$1***REDACTED***')
    .replace(URL_CRED_RE, '$1***REDACTED***@')
    .replace(SECRET_ASSIGNMENT_RE, '$1=***REDACTED***')
    .replace(SECRET_FLAG_RE, '$1***REDACTED***')
}