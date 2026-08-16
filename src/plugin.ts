import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ConfigManager } from "./config/ConfigManager.js";
import { PatternMatcher } from "./rules/PatternMatcher.js";
import { RuleEvaluator } from "./rules/RuleEvaluator.js";
import {
  extractFileFromCommand,
  isSafeFile,
  readSafely,
  isSuspiciousFileContent,
  buildClassifierPrompt as baseBuildClassifierPrompt,
  SAFE_FILE_SIZE_BYTES,
} from "./utils/FileExtraction.js";
import { version } from "../package.json";

const HOME = process.env.USERPROFILE || process.env.HOME || "";
const LOG_FILE = path.join(HOME, ".config", "opencode", "auto-mode.log");

function log(msg: string): void {
  const line = `[AutoMode][v${version}][${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

let configManager: ConfigManager | null = null;
let ruleEvaluator: RuleEvaluator | null = null;
let client: any = null;
let initialized = false;
const decisions = new Map<string, { decision: string; reason: string }>();
const agentBySession = new Map<string, string>();
let consecutiveDenials = 0;
let totalDenials = 0;
let opencodeAllowList: string[] | null = null;
let allowListLoadedAt = 0;
let configMtime = 0;

function maybeReloadConfig(): void {
  if (!configManager) return;
  try {
    const mtime = fs.statSync(getConfigPath()).mtimeMs;
    if (mtime !== configMtime) {
      configMtime = mtime;
      configManager.reload(getConfigPath());
      const config = configManager.getConfig();
      log(
        `Config reloaded: rules=${(config.blockRules || []).length} exceptions=${(config.allowExceptions || []).length} llm=${config.llm?.provider || "none"}`
      );
    }
  } catch (e: any) {
    log(`config reload error: ${e?.message || e}`);
  }
}

function getConfigDir(): string {
  return process.env.OPENCODE_CONFIG_DIR || path.join(HOME, ".config", "opencode");
}

function getOpenCodeConfigPath(): string {
  return path.join(getConfigDir(), "opencode.jsonc");
}

function collectAllowPatterns(perm: any, patterns: string[]): void {
  if (!perm || typeof perm !== "object") return;
  for (const [key, value] of Object.entries(perm)) {
    if (key === "*") continue;
    if (typeof value === "object" && value) {
      for (const [pattern, action] of Object.entries(value as Record<string, any>)) {
        if (pattern === "*") continue;
        if (action === "allow" || action === true) patterns.push(pattern);
      }
    } else if (value === "allow" || value === true) {
      patterns.push(key);
    }
  }
}

function loadOpenCodeAllowList(agentName: string): string[] {
  const configPath = getOpenCodeConfigPath();
  try {
    const mtime = fs.statSync(configPath).mtimeMs;
    if (opencodeAllowList && mtime === allowListLoadedAt) return opencodeAllowList;
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = parse(raw);
    const patterns: string[] = [];
    collectAllowPatterns(parsed?.permission, patterns);
    collectAllowPatterns(parsed?.agent?.[agentName]?.permission, patterns);
    const unique = [...new Set(patterns)];
    opencodeAllowList = unique;
    allowListLoadedAt = mtime;
    log(
      `allow-list loaded: ${unique.length} patterns (agent=${agentName}) [${unique.slice(0, 12).join(", ")}${unique.length > 12 ? ", ..." : ""}]`
    );
    return unique;
  } catch (e: any) {
    log(`allow-list load error: ${e?.message || e}`);
    return [];
  }
}

const patternToRegex = (pattern: string): RegExp => {
  let out = "";
  for (const ch of pattern) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
};

let softRulesCache: string[] | null = null;
let softRulesLoadedAt = 0;

function loadSoftRules(): string[] {
  const configPath = getConfigPath();
  try {
    const mtime = fs.statSync(configPath).mtimeMs;
    if (softRulesCache && mtime === softRulesLoadedAt) return softRulesCache;
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = parse(raw);
    const rules = Array.isArray(parsed?.softRules) ? parsed.softRules : [];
    softRulesCache = rules;
    softRulesLoadedAt = mtime;
    log(`softRules loaded: ${rules.length} rule(s) [${rules.join(", ")}]`);
    return rules;
  } catch {
    return softRulesCache || [];
  }
}

function isOpenCodeAllowed(command: string, sessionID: string): boolean {
  const agentName = agentBySession.get(sessionID) || "general";
  for (const pattern of loadOpenCodeAllowList(agentName)) {
    try {
      if (patternToRegex(pattern).test(command)) return true;
    } catch {}
  }
  return false;
}

const SECRET_FILE_PATTERN =
  /(\.env(\.\w+)?|\bcredentials\b|\.ssh|id_(rsa|ed25519|dsa|ecdsa)|\.netrc|\.npmrc)/i;
const SECRET_KEYWORD_PATTERN =
  /(api[_-]?keys?|\bsecrets?\b|\btokens?\b|\bpasswords?\b)/i;

const FILE_REGEX = /(?<=\s)([\w._-]+)["']?(?=\s|$|;|\||&|`|"|')/i;

function isSecretFileAccess(command: string): boolean {
  return SECRET_FILE_PATTERN.test(command);
}

function isSecretSensitive(command: string): boolean {
  return SECRET_FILE_PATTERN.test(command) || SECRET_KEYWORD_PATTERN.test(command);
}

export { extractFileFromCommand, isSafeFile, readSafely, isSuspiciousFileContent };
const buildClassifierPrompt = baseBuildClassifierPrompt;

function normalizeRules(rules: any[], softRules?: string[]): any[] {
  const soft = new Set(softRules || []);
  return (rules || []).map((r) => {
    if (r && soft.has(r.id)) {
      r = { ...r, severity: "soft" };
    }
    if (
      r &&
      r.type === "pattern" &&
      typeof r.pattern === "string" &&
      !r.pattern.startsWith("regex:") &&
      /[\\()|+{}^$]/.test(r.pattern)
    ) {
      return { ...r, pattern: `regex:${r.pattern}` };
    }
    return r;
  });
}

function getConfigPath(): string {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return path.join(process.env.OPENCODE_CONFIG_DIR, "auto-mode.jsonc");
  }
  return path.join(HOME, ".config", "opencode", "auto-mode.jsonc");
}

function getConfig(): any {
  return configManager ? configManager.getConfig() : {};
}

async function callLLM(prompt: string): Promise<string> {
  const llm = getConfig().llm || {};
  const baseUrl = llm.baseUrl || "http://localhost:18780/v1";
  const apiKey = llm.apiKey || "";
  const model = llm.model || "qwen/qwen3.5-9b";
  const timeoutMs = llm.timeout || 8000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`LLM API error: ${res.status} ${res.statusText}`);
    }
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

let llmQueue: Promise<any> = Promise.resolve();
function callLLMSerialized(prompt: string): Promise<string> {
  const task = llmQueue.then(() => callLLM(prompt));
  llmQueue = task.catch(() => {});
  return task;
}

function parseDecision(text: string): { decision: string; reason: string } {
  try {
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const json = JSON.parse(cleaned);
    if (typeof json.allow === "boolean") {
      return {
        decision: json.allow ? "allow" : "deny",
        reason: String(json.reason || "").slice(0, 200),
      };
    }
  } catch {
    log(`Parse failed, raw: ${String(text).slice(0, 300).replace(/\n/g, "\\n")}`);
  }
  return { decision: "ask", reason: "Unparseable LLM response" };
}

async function classifyCommand(
  command: string,
  sessionID: string
): Promise<{ decision: string; reason: string }> {
  maybeReloadConfig();
  const config = getConfig();

  if (isSecretSensitive(command)) {
    log(`SECRET-GUARD: "${command.slice(0, 80)}" -> LLM (secret path/keywords)`);
  } else if (isOpenCodeAllowed(command, sessionID)) {
    log(`ALLOW-LIST skip: "${command.slice(0, 80)}"`);
    return { decision: "allow", reason: "opencode permission allow-list" };
  }

  const toolCall: any = {
    toolName: "Bash",
    arguments: { command },
    context: {
      agentName: agentBySession.get(sessionID) || "general",
      sessionId: sessionID,
    },
  };

  const normalizedRules = normalizeRules(config.blockRules, loadSoftRules());
  const ruleResult = (ruleEvaluator as any).evaluate(
    toolCall,
    normalizedRules,
    config.allowExceptions || [],
    config.trustBoundary
  );

  if (ruleResult.evaluation === "blocked") {
    const ruleId = ruleResult.matchedRule || "matched";
    const rule = (normalizedRules || []).find((r: any) => r.id === ruleId);
    const severity = rule?.severity || "high";
    const reason = `Rule ${ruleId} blocked command`;
    if (severity === "critical") {
      log(`RULES deny: "${command.slice(0, 80)}" (${reason})`);
      return { decision: "deny", reason };
    }
    if (severity === "soft") {
      log(`RULES soft: "${command.slice(0, 80)}" (${reason}) -> LLM classification`);
    } else {
      log(`RULES ask: "${command.slice(0, 80)}" (${reason})`);
      return { decision: "ask", reason: `${reason} — user confirmation required` };
    }
  }
  if (ruleResult.evaluation === "allowed") {
    log(`RULES allow: "${command.slice(0, 80)}" (${ruleResult.matchedException || "exception"})`);
    return { decision: "allow", reason: "Allowed by exception" };
  }

  if (isSecretFileAccess(command)) {
    log(`SECRET-GUARD file: "${command.slice(0, 80)}"`);
    return { decision: "ask", reason: "Secret file access — user confirmation required" };
  }

  const llm = config.llm || {};
  if (llm.enabled === false) {
    return { decision: "ask", reason: "LLM classification disabled" };
  }

  try {
    const filePath = extractFileFromCommand(command);
    let fileContent: string | null = null;
    if (filePath) {
      fileContent = readSafely(filePath);
      if (fileContent && isSuspiciousFileContent(fileContent)) {
        log(`SUSPICIOUS FILE DETECTED: "${filePath}" — potential security risk, flagging for LLM review`);
      }
    }
    const text = await callLLMSerialized(buildClassifierPrompt(command, filePath, fileContent));
    const result = parseDecision(text);
    log(`LLM classify: "${command.slice(0, 80)}" (file=${filePath || "none"}) -> ${result.decision} (${result.reason})`);
    if (result.decision === "deny") {
      return { decision: "ask", reason: `LLM flagged: ${result.reason}` };
    }
    return result;
  } catch (e: any) {
    log(`LLM classify error: ${e?.message || e}`);
    const fallback = config.fallback || {};
    const onError = fallback.onError || "ask-user";
    if (onError === "allow") return { decision: "allow", reason: "LLM error, fallback allow" };
    if (onError === "deny") return { decision: "ask", reason: "LLM error, fallback ask" };
    return { decision: "ask", reason: "LLM unavailable" };
  }
}

async function replyPermission(
  sessionID: string,
  permissionID: string,
  response: string
): Promise<void> {
  if (!client) return;
  try {
    await client.postSessionIdPermissionsPermissionId({
      path: { id: sessionID, permissionID },
      body: { response },
    });
    log(`Permission reply: ${sessionID} ${permissionID} -> ${response}`);
  } catch (e: any) {
    log(`Permission reply error: ${e?.message || e}`);
  }
}

export const opencodeAutoMode = async (ctx: any): Promise<Record<string, any>> => {
  if (initialized) return {};
  initialized = true;
  log("PLUGIN INITIALIZED");
  try {
    client = ctx?.client;
    configManager = new ConfigManager(getConfigPath());
    configManager.load();
    try {
      configMtime = fs.statSync(getConfigPath()).mtimeMs;
    } catch {}
    ruleEvaluator = new RuleEvaluator(new PatternMatcher() as any);
    const config = configManager.getConfig();
    log(
      `Config loaded: rules=${(config.blockRules || []).length} exceptions=${(config.allowExceptions || []).length} llm=${config.llm?.provider || "none"}`
    );
  } catch (e: any) {
    log(`INIT FAILED: ${e?.message || e}`);
    return {};
  }

  return {
    "tool.execute.before": async (input: any, output: any) => {
      try {
        if (!input || input.tool !== "bash") return;
        const command = output?.args?.command;
        if (!command || typeof command !== "string" || command.length === 0) return;
        if (command.startsWith("# BLOCKED")) return;
        log(`tool.execute.before: ${input.callID} "${command.slice(0, 100)}"`);

        const sessionID = input.sessionID || "";
        const result = await classifyCommand(command, sessionID);
        if (result.decision === "deny") {
          consecutiveDenials++;
          totalDenials++;
        } else {
          consecutiveDenials = 0;
        }
        decisions.set(input.callID, result);
        if (decisions.size > 200) {
          const firstKey = decisions.keys().next().value;
          if (firstKey) decisions.delete(firstKey);
        }
      } catch (e: any) {
        log(`tool.execute.before error: ${e?.message || e}`);
      }
    },

    event: async (input: any) => {
      try {
        const evt = input?.event;
        if (!evt || !evt.type) return;

        if (evt.type === "session.created") {
          consecutiveDenials = 0;
          totalDenials = 0;
          const info = evt.properties?.info;
          if (info?.id && info?.agent) {
            agentBySession.set(info.id, info.agent);
          }
          log(`session.created: agent=${info?.agent} session=${info?.id}`);
        }

        if (evt.type === "permission.asked") {
          const props = evt.properties || {};
          const sessionID = props.sessionID;
          const permissionID = props.id;
          const command = props.metadata?.command || "";
          const callID = props.tool?.callID;
          log(
            `permission.asked: ${permissionID} callID=${callID} "${String(command).slice(0, 100)}"`
          );

          const config = getConfig();
          const escalation = config.escalation || { consecutive: 3, total: 20 };

          let result = callID ? decisions.get(callID) : undefined;
          if (!result && command) {
            result = await classifyCommand(command, sessionID);
          }
          if (callID) decisions.delete(callID);

          if (!result || result.decision === "ask") {
            log(`permission.asked: asking user (no auto decision)`);
            return;
          }

          if (consecutiveDenials >= escalation.consecutive && result.decision === "deny") {
            log(`permission.asked: escalation threshold reached, asking user`);
            return;
          }

          if (totalDenials >= escalation.total) {
            log(`permission.asked: total denial threshold reached, asking user`);
            return;
          }

          if (result.decision === "allow") {
            await replyPermission(sessionID, permissionID, "once");
          } else if (result.decision === "deny") {
            await replyPermission(sessionID, permissionID, "reject");
          }
        }
      } catch (e: any) {
        log(`event hook error: ${e?.message || e}`);
      }
    },
  };
};

export default opencodeAutoMode;
