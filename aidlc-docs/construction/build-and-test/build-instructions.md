# Build Instructions

## Prerequisites

- **Node.js**: 18.x or higher
- **npm**: 9.x or higher
- **Operating System**: Windows, macOS, or Linux
- **Disk Space**: ~100MB (including node_modules)
- **Memory**: 512MB minimum recommended

## Build Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Build All Units

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### 3. Verify Build Success

**Expected Output:**

- `dist/` directory created with compiled JavaScript files
- `dist/index.js` — Plugin entry point
- `dist/index.d.ts` — TypeScript declarations
- All subdirectories (`classifier/`, `config/`, `rules/`, etc.) compiled

### 4. Run Tests

```bash
npm test
```

**Expected Output:**

- 303 tests passed across 20 test suites
- Code coverage: ~84% statements, ~75% branches, ~85% functions, ~84% lines
- All unit tests pass
- All integration tests pass
- All property-based tests pass

### 5. Run Linter (Optional)

```bash
npm run lint
```

### 6. Run Formatter (Optional)

```bash
npm run format
```

## Build Artifacts

| Artifact | Location | Description |
|----------|----------|-------------|
| Compiled JavaScript | `dist/` | Transpiled TypeScript output |
| TypeScript Declarations | `dist/**/*.d.ts` | Type declaration files |
| Package Manifest | `package.json` | NPM package metadata |
| Default Rules | `config/default-block-rules.jsonc` | 30 block rules + 10 allow exceptions |
| Documentation | `docs/` | Setup and configuration guides |
| License | `LICENSE` | MIT License |
| README | `README.md` | Project overview and usage |

## Continuous Integration (Optional)

For CI/CD, add these steps:

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: '18'
- run: npm ci
- run: npm test
- run: npm run build
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `tsc: command not found` | Run `npm install` first |
| TypeScript compilation errors | Check `tsconfig.json` target and module settings |
| Test failures | Run `npm test` and review failing test output |
| Missing dependencies | Run `npm install` to restore `node_modules/` |
| Outdated dependencies | Run `npm update` to upgrade |

## Environment Variables

No environment variables are required for building. API keys are configured at runtime via `auto-mode.jsonc`.
