import * as fs from 'node:fs'
import { redact } from '../utils/Redact.js'

const SNIPPET_MAX_LEN = 1000

export interface ClassificationRecord {
  id: string
  ts: string
  command: string
  file_path?: string | null
  file_snippet?: string | null
  decision: string
  reason: string
}

export interface OutcomeRecord {
  id: string
  ts: string
  command: string
  outcome: 'approved' | 'denied'
  reason: string
}

export interface TelemetryRecord extends ClassificationRecord {
  type: 'classification'
}

export interface TelemetryOutcomeRecord extends OutcomeRecord {
  type: 'outcome'
}

function sanitizeSnippet(content: string | null | undefined): string | null {
  if (!content) return null
  const cleaned = redact(content).replace(/\s+/g, ' ').trim()
  if (cleaned.length <= SNIPPET_MAX_LEN) return cleaned
  return `${cleaned.slice(0, SNIPPET_MAX_LEN)}…[truncated]`
}

export class TelemetryLogger {
  private enabled: boolean
  private filePath: string

  constructor(enabled: boolean, filePath: string) {
    this.enabled = enabled
    this.filePath = filePath
  }

  isEnabled(): boolean {
    return this.enabled
  }

  updateConfig(enabled: boolean, filePath: string): void {
    this.enabled = enabled
    this.filePath = filePath
  }

  logClassification(record: ClassificationRecord): void {
    if (!this.enabled || !this.filePath) return
    const rec: TelemetryRecord = { type: 'classification', ...record }
    this.append(rec)
  }

  logOutcome(record: OutcomeRecord): void {
    if (!this.enabled || !this.filePath) return
    const rec: TelemetryOutcomeRecord = { type: 'outcome', ...record }
    this.append(rec)
  }

  private append(record: TelemetryRecord | TelemetryOutcomeRecord): void {
    const line = `${JSON.stringify(record)}\n`
    fs.promises.appendFile(this.filePath, line, { flag: 'a' }).catch(() => {})
  }
}

export { sanitizeSnippet }
