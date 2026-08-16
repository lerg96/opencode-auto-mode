# opencode-auto-mode — Agent Guide

## Repo at a glance

- **Package**: `@lerg96/opencode-auto-mode` — an OpenCode plugin for automatic Bash command approval using a two-stage classifier (pattern rules + LLM).
- **Single library, no monorepo**. Entry: `src/index.ts` → `src/plugin.ts` (main plugin logic, ~470 lines).
- **TS lib ES2022, ESM only**, built with `tsup` to `dist/` (CJS + ESM) + `tsc --emitDeclarationOnly`.
- **Config**: `~/.config/opencode/auto-mode.jsonc`. Example at `auto-mode.jsonc.example`. Bundled defaults at `src/config/default-block-rules.jsonc`.
- **OpenCode reads permission config from** `~/.config/opencode/opencode.jsonc` (via `jsonc-parser`).

## Commands

```
npm run build          # tsup (esm+cjs, clean) + dts only
npm test               # jest --coverage (threshold: 68% br / 75% fn,ln,stmt)
npm run test:unit      # tests/unit/ only
npm run test:integration # tests/integration/ only
npm run test:pbt       # tests/property-based/ only
npm run lint           # eslint src/  (no eslint config shipped — will fail if .eslintrc missing)
npm run format         # prettier --write src/  (no prettier config shipped)
npm run prepublishOnly # build + test (runs on npm publish)
```

No `.eslintrc` or `.prettierrc` files exist. `npm run lint` and `npm run format` will error unless the user adds them. This is intentional — the package leaves formatting/linting up to the consumer.

## Architecture essentials

```
src/
├── index.ts                 # re-exports opencodeAutoMode, default export with plugin id
├── plugin.ts                # THE MAIN FILE: init hooks, classifyCommand(), LLM call, decision wiring
├── config/ConfigManager.ts  # loads/reloads auto-mode.jsonc
├── rules/
│   ├── PatternMatcher.ts    # glob-to-regex + exact match
│   └── RuleEvaluator.ts     # applies blockRules + allowExceptions + trustBoundary
├── classifier/              # split-out pipeline modules (CircuitBreaker, RetryHandler, FallbackExecutor, etc.)
├── injection/               # prompt injection detection
├── escalation/              # denial threshold tracking
├── deny-and-continue/       # auto-retry / ask-user modes
├── permissions/             # permission pre-checker
├── state/                   # session state
└── types/                   # shared TS types
```

**Execution flow in `plugin.ts`** (classifyCommand, line 264):
1. Secret guard: if command touches secret paths/keywords → LLM directly.
2. Allow-list skip: check OpenCode permission config `opencode.jsonc` for matching allow patterns → skip classifier.
3. Rule evaluation: `RuleEvaluator.evaluate()` against blockRules + allowExceptions.
   - `critical` → deny
   - `soft` → falls through to LLM
   - `medium`/`low` (`high` in code) → ask user
   - `allowed` → allow
4. Secret file access (non-keyword) → ask user.
5. LLM classification (if enabled): builds a classifier prompt, POSTs to OpenAI-compatible chat endpoint, parses JSON response.
6. LLM error → fallback config (`onTimeout`/`onError`).

**Plugin hooks** (`opencodeAutoMode`, line 361):
- `tool.execute.before` — intercepts all Bash tool calls before execution, classifies the command, stores decision.
- `event` handler — listens for `session.created` (reset denial counters), `permission.asked` (auto-approve/deny or defer to user, respecting escalation thresholds).

## Testing

- Jest with `@swc/jest` transformer (`jest.config.js`).
- Node environment. Tests in `tests/` match `**/*.test.ts` and `**/*.pbt.ts`.
- Coverage thresholds are **enforced** — `npm test` fails if below 68% branches / 75% other metrics.
- Property-based tests use `fast-check` in `tests/property-based/`.
- No test database, no external services needed. Tests are pure unit + one integration test.

## Gotchas

- **`.env` files are gitignored** but the plugin reads config from `~/.config/opencode/` on the host machine — not from repo files.
- **SWC config** lives in `.swcrc` with `module.type: "es6"` — do not change to `commonjs`.
- **TS `moduleResolution: "bundler"`** — don't switch to `node`/`node16`/`nodenext`.
- **`plugin.ts` uses `any` heavily** for OpenCode SDK types (the SDK is not typed). This is expected.
- **LLM endpoint** defaults to `http://localhost:18780/v1` (Ollama-compatible). Configure via `auto-mode.jsonc` `llm.baseUrl`.
- **Config auto-reload**: `plugin.ts` watches mtime of `auto-mode.jsonc` and reloads on next classification call.
- **Windows paths**: `plugin.ts` uses `process.env.USERPROFILE || process.env.HOME` for config paths.

## Documentation

- `docs/CONFIGURATION.md` — full config reference
- `docs/BUNDLED-RULES.md` — all 30 shipped block rules
- `docs/SETUP.md` — installation guide
- `README.md` — feature overview
