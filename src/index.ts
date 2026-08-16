import { opencodeAutoMode } from "./plugin.js";

export { opencodeAutoMode };
export { extractFileFromCommand, isSafeFile, readSafely, isSuspiciousFileContent, buildClassifierPrompt } from "./utils/FileExtraction.js";

export default {
  id: "@lerg96/opencode-auto-mode",
  server: opencodeAutoMode,
};
