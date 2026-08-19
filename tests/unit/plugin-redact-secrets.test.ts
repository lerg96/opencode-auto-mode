import { redact } from '../../src/plugin'

describe('redact — bare secret token/assignment edge cases', () => {
  it('redacts AWS_ACCESS_KEY_ID=value (the _ID suffix fix)', () => {
    const out = redact('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE')
    expect(out).toContain('AWS_ACCESS_KEY_ID=***REDACTED***')
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('still redacts plain password=value', () => {
    const out = redact('password=supersecret')
    expect(out).toContain('password=***REDACTED***')
    expect(out).not.toContain('supersecret')
  })

  it('does not false-match "accessory" or similar words', () => {
    const out = redact('this is an accessory to the crime')
    expect(out).not.toContain('***REDACTED***')
  })

  it('does not false-match "SECRETARY" as a keyword boundary case', () => {
    const out = redact('send to the secretary')
    expect(out).not.toContain('***REDACTED***')
  })

  it('aws_secret_access_key=X still redacted correctly', () => {
    const out = redact('export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG')
    expect(out).toContain('AWS_SECRET_ACCESS_KEY=***REDACTED***')
    expect(out).not.toContain('wJalrXUtnFEMI/K7MDENG')
  })

  it('token=something is redacted', () => {
    const out = redact('token=abc123def456')
    expect(out).toContain('token=***REDACTED***')
    expect(out).not.toContain('abc123def456')
  })

  it('ACCESS_KEY=value IS redacted (access_key keyword match)', () => {
    const out = redact('ACCESS_KEY=somevalue')
    expect(out).toContain('***REDACTED***')
    expect(out).not.toContain('somevalue')
  })

  it('does not false-match "passwords" inside a word without assignment', () => {
    const out = redact('the passwords for the system are stored separately')
    expect(out).not.toContain('***REDACTED***')
  })

  it('skips shell-metachar-delimited values by design (" is terminator)', () => {
    // The regex [^\s"';&|`$]+ intentionally stops at shell metachars
    // so quoted values are safely skipped in log context
    const out = redact('secret="value with spaces"')
    expect(out).not.toContain('***REDACTED***')
  })
})
