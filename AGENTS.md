# opencode-auto-mode — Agent Guide

## Repo at a glance

- **Package**: `@lerg96/opencode-auto-mode` — an OpenCode plugin for automatic Bash command approval using a two-stage classifier (pattern rules + LLM).
- **Single library, no monorepo**. Entry: `src/index.ts` → `src/plugin.ts` (main plugin logic, ~500 lines).
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
├── index.ts                 # re-exports + default plugin object with id
├── plugin.ts                # THE main file: init hooks, classifyCommand(), LLM call, decision wiring
├── config/ConfigManager.ts  # loads/reloads auto-mode.jsonc, validates, applies defaults
├── config/default-block-rules.jsonc  # 30 block rules + 10 allow exceptions
├── rules/
│   ├── PatternMatcher.ts    # glob-to-regex + substring match
│   └── RuleEvaluator.ts     # evaluates blockRules + allowExceptions + trustBoundary
├── classifier/              # pipeline modules (ClassificationService, TranscriptClassifier, CircuitBreaker, RetryHandler, FallbackExecutor, etc.)
├── injection/               # prompt injection detection (InjectionProbe, InjectionProtectionService)
├── escalation/              # denial threshold tracking
├── deny-and-continue/       # auto-retry / ask-user modes
├── permissions/             # permission pre-checker
├── state/                   # session state
├── utils/FileExtraction.ts  # file extraction from commands, safe reading, suspicious content detection
└── types/                   # shared TS types (PluginConfig, RuleTypes, ToolCall, etc.)
```

**Execution flow in `plugin.ts`** (classifyCommand):

1. Secret guard: if command touches secret paths/keywords (`~/.ssh`, `.env`, `credentials`, `api_keys`, `secrets`, `tokens`, `passwords`) → LLM directly.
2. Allow-list skip: parse OpenCode permission config for matching allow patterns → skip classifier.
3. Rule evaluation via `RuleEvaluator.evaluate()`:
   - `critical` → deny
   - `soft` (from `softRules` config) → falls through to LLM
   - `medium`/`low` → ask user
   - `allowed` → allow
4. Secret file access (non-keyword) → ask user.
5. LLM classification: builds classifier prompt, POSTs to OpenAI-compatible endpoint, parses JSON response.
6. LLM error → fallback config (`onTimeout`/`onError`).

**LLM default**: `http://localhost:18780/v1` (Ollama-compatible), model `qwen/qwen3.5-9b` unless overridden in config.

**Serialized LLM queue**: `callLLMSerialized()` uses `.then()` chaining so only one LLM request runs at a time.

**Plugin hooks**:

- `tool.execute.before` — intercepts all Bash tool calls before execution, classifies, stores decision.
- `event` handler — `session.created` resets denial counters; `permission.asked` auto-approves/denies respecting escalation thresholds.

## Testing

- Jest with `@swc/jest` transformer (`.swcrc` has `module.type: "es6"` — do not change).
- Tests in `tests/` match `**/*.test.ts` and `**/*.pbt.ts`.
- Coverage thresholds **enforced** — `npm test` fails below 68% branches / 75% other.
- 19 unit tests + 1 integration test + 3 property-based tests (using `fast-check`).
- No test database, no external services. Tests are pure unit + one integration test (all dependencies mocked).

## Gotchas

- **`.env` files are gitignored** but the plugin reads config from `~/.config/opencode/` on the host — not from repo files.
- **SWC config** in `.swcrc` uses `"module": {"type": "es6"}` — switching to `commonjs` breaks ESM output.
- **TS `moduleResolution: "bundler"`** — don't switch to `node`/`node16`/`nodenext`.
- **`plugin.ts` uses `any` heavily** for OpenCode SDK types (the SDK is not typed). Expected.
- **Config auto-reload**: `plugin.ts` watches mtime of `auto-mode.jsonc` and reloads on next classification call.
- **Windows paths**: `plugin.ts` uses `process.env.USERPROFILE || process.env.HOME`.
- **Default rules fallback**: if `src/config/default-block-rules.jsonc` can't be parsed, `ConfigManager` has a hardcoded fallback array (30 rules) in `loadDefaultBlockRules()`.
- **NormalizeRules**: `plugin.ts` auto-prefixes patterns with `regex:` when they contain regex metacharacters (`\()|+{}^$`).

## Documentation

- `docs/CONFIGURATION.md` — full config reference
- `docs/BUNDLED-RULES.md` — all 30 shipped block rules
- `docs/SETUP.md` — installation guide
- `README.md` — feature overview
