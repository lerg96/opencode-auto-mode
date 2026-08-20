# opencode-auto-mode — Agent Guide

## Repo at a glance

- **Package**: `@lerg96/opencode-auto-mode` — an OpenCode plugin for automatic Bash command approval using a two-stage classifier (pattern rules + LLM).
- **Single library, no monorepo**. Entry: `src/index.ts` → `src/plugin.ts` (main plugin logic, ~800 lines).
- **TS lib ES2022, ESM module** ( `"type": "module"` ), built with `tsup` to `dist/` (CJS + ESM) + `tsc --emitDeclarationOnly`.
- **TypeScript 7.x** — check `tsconfig.json` before assuming older TS behavior.
- **Config**: `~/.config/opencode/auto-mode.jsonc` (or `$OPENCODE_CONFIG_DIR/auto-mode.jsonc`). Example at `auto-mode.jsonc.example`. Bundled defaults at `src/config/default-block-rules.jsonc`.
- **OpenCode permission config**: `~/.config/opencode/opencode.jsonc` (via `jsonc-parser`).

## Commands

```
npm run build          # tsup (esm+cjs, clean) + dts only
npm test               # jest --coverage (threshold: 68% br / 75% fn,ln,stmt)
npm run test:unit      # tests/unit/ only
npm run test:integration # tests/integration/ only
npm run test:pbt       # tests/property-based/ only
npm run format         # prettier --write src/
npm run prepublishOnly # build + test (runs on npm publish)
```

**Note**: `npm run lint` (`eslint src/`) intentionally has no `.eslintrc` — it will error. This is by design; the package leaves linting to the consumer.

**Git hook**: pre-commit runs `npx lint-staged` (prettier + tests on staged files).

## Prettier defaults (from `.prettierrc`)

`semi: false, singleQuote: true, tabWidth: 2, trailingComma: "es5"`

## Architecture

```
src/
├── index.ts                       # re-exports + default plugin object with id
├── plugin.ts                      # THE main file: init hooks, classifyCommand(), LLM call, denyMode wiring, injection scan hook
├── LlmClient.ts                   # OpenAI-compatible client + retry/fallback (callLlmWithFallback)
├── config/
│   ├── ConfigManager.ts           # loads/reloads auto-mode.jsonc, validates, applies defaults
│   └── default-block-rules.jsonc  # 52 block rules + 10 allow exceptions (authoritative source)
├── rules/
│   ├── PatternMatcher.ts          # regex/substring matching + suspicious-pattern (ReDoS) guard
│   └── RuleEvaluator.ts           # evaluates blockRules + allowExceptions + trustBoundary
├── injection/                     # prompt injection detection (InjectionProbe, InjectionProtectionService)
├── escalation/                    # denial threshold tracking (EscalationService)
├── deny-and-continue/             # auto-retry / ask-user modes (DenyAndContinueService)
├── state/                         # session state (SessionState)
├── utils/
│   ├── FileExtraction.ts          # file extraction from commands, safe reads, suspicious content, classifier prompt builder
│   └── Redact.ts                  # shared secret redaction (SECRET_*_RE + redact())
└── types/                         # shared TS types (PluginConfig, RuleTypes, ToolCall, SessionTypes, DenyAndContinueTypes, ...)
```

**Execution flow in `plugin.ts`** (classifyCommand):

1. Secret guard: if command touches secret paths/keywords (`~/.ssh`, `.env`, `credentials`, `api_keys`, `secrets`, `tokens`, `passwords`) → LLM directly.
2. Allow-list skip: parse OpenCode permission config for matching allow patterns → skip classifier.
3. Rule evaluation via `RuleEvaluator.evaluate()`:
   - `critical` → deny, routed through `applyDenyMode` (DenyAndContinueService): `ask-user` → ask, `auto-retry`/`both` → deny with "safer approach" retry, `both` escalates to ask after `escalation.consecutive`
   - `soft` (from `softRules` config) → falls through to LLM
   - `medium`/`low` → ask user
   - `allowed` → allow
4. Secret file access (non-keyword) → ask user.
5. LLM classification: builds classifier prompt, POSTs to OpenAI-compatible endpoint, parses JSON response.
6. LLM error → fallback config (`onTimeout`/`onError`).
7. `tool.execute.after` → scans bash tool output with `InjectionProtectionService` for prompt injection and logs warnings (never blocks).

**LLM default**: `DEFAULT_LLM_CONFIG` is `provider: 'anthropic'`, `model: 'claude-sonnet-4-20250514'`, `apiKeysRef: 'opencode-provider-config'`. When no `baseUrl` is configured, calls fall back to `http://localhost:18780/v1` (Ollama-compatible).

**Serialized LLM queue**: `callLLMSerialized()` uses `.then()` chaining so only one LLM request runs at a time.

**Plugin hooks**:

- `tool.execute.before` — intercepts all Bash tool calls before execution, classifies, stores decision.
- `tool.execute.after` — scans bash tool output for prompt injection via `InjectionProtectionService`; logs warnings, never blocks.
- `event` handler — `session.created`/`session.deleted` reset denial counters and injection scan state; `permission.asked` auto-approves/denies respecting escalation thresholds.

## Testing

- Jest with `@swc/jest` transformer (`.swcrc` has `module.type: "es6"` — do not change).
- Tests in `tests/` match `**/*.test.ts` and `**/*.pbt.ts`.
- Coverage thresholds **enforced** — `npm test` fails below 68% branches / 75% other.
- 693 tests / 30 suites (unit + integration + property-based, using `fast-check`), coverage ~93% stmts / ~85% br / ~98% fn / ~95% lines.
- No test database, no external services. Tests are pure unit + integration (all dependencies mocked).

## Gotchas

- **`.env` files are gitignored** but the plugin reads config from `~/.config/opencode/` on the host — not from repo files.
- **SWC config** in `.swcrc` uses `"module": {"type": "es6"}` — switching to `commonjs` breaks ESM output.
- **TS `moduleResolution: "bundler"`** — don't switch to `node`/`node16`/`nodenext`.
- **`plugin.ts` uses `any` heavily** for OpenCode SDK types (the SDK is not typed). Expected.
- **Config auto-reload**: `plugin.ts` watches mtime of `auto-mode.jsonc` and reloads on next classification call.
- **Windows paths**: `plugin.ts` uses `process.env.USERPROFILE || process.env.HOME`.
- **Default rules fallback**: if `src/config/default-block-rules.jsonc` can't be parsed, `ConfigManager` has a hardcoded fallback (52 block rules + 10 allow exceptions, aligned with the JSONC) in `loadDefaultBlockRules()`/`loadDefaultAllowExceptions()`.
- **NormalizeRules**: `plugin.ts` auto-prefixes patterns with `regex:` when they contain regex metacharacters (`\()|+{}^$`).

## Documentation

- `docs/CONFIGURATION.md` — full config reference
- `docs/BUNDLED-RULES.md` — all 52 shipped block rules + 10 allow exceptions
- `docs/SETUP.md` — installation guide
- `README.md` — feature overview
