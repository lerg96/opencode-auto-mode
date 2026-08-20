import { opencodeAutoMode } from './plugin.js'

export { opencodeAutoMode }
export {
  extractFileFromCommand,
  isSafeFile,
  readSafely,
  isSuspiciousFileContent,
  buildSystemPrompt,
  buildUserPrompt,
  buildClassifierPrompt,
} from './utils/FileExtraction.js'
export {
  TelemetryLogger,
  sanitizeSnippet,
} from './telemetry/TelemetryLogger.js'
export type {
  ClassificationRecord,
  OutcomeRecord,
} from './telemetry/TelemetryLogger.js'

export default {
  id: '@lerg96/opencode-auto-mode',
  server: opencodeAutoMode,
}
