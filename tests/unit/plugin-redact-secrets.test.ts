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

  it('redacts quoted values (JSON-style and --flag "value") to prevent leak', () => {
    // Previously quoted values were skipped by design; that let JSON configs
    // ("password":"hunter2") and --password "x" reach the LLM/logs verbatim.
    const out = redact('secret="value with spaces"')
    expect(out).toContain('***REDACTED***')
    expect(out).not.toContain('value with spaces')
  })

  it('redacts underscore-prefixed credential names (GITHUB_TOKEN=...)', () => {
    const out = redact('export GITHUB_TOKEN=ghp_1234567890abcdef')
    expect(out).toContain('GITHUB_TOKEN=***REDACTED***')
    expect(out).not.toContain('ghp_1234567890abcdef')
  })

  it('redacts JSON-style quoted credential values', () => {
    const out = redact('{"api_key": "sk-abcdef123456", "password":"hunter2"}')
    expect(out).not.toContain('sk-abcdef123456')
    expect(out).not.toContain('hunter2')
    expect(out).toContain('***REDACTED***')
  })

  it('redacts non-http connection strings (postgres://, jdbc:mysql://)', () => {
    const out = redact('psql "postgres://appuser:s3cr3t@db:5432/app"')
    expect(out).not.toContain('appuser:s3cr3t@')
    expect(out).toContain('postgres://***REDACTED***@db')
    const jdbc = redact('jdbc:mysql://root:passwd@db:3306/schema')
    expect(jdbc).not.toContain('root:passwd@')
  })
})
