# Setup Guide: OpenCode Auto-Mode Plugin

## Prerequisites

- Node.js 18+ (for building and development)
- OpenCode installed and configured
- Access to an LLM API (Anthropic, OpenAI, or local model — default is Ollama at `http://localhost:18780/v1`)

## Installation Methods

### Method 1: npm Install (Recommended)

```bash
npm install @lerg96/opencode-auto-mode
```

After installation, configure the plugin by creating `~/.config/opencode/auto-mode.jsonc` (see [Configuration Guide](CONFIGURATION.md)).

### Method 2: Local development install

1. **Clone the repository**:

```bash
git clone <repository-url>
cd opencode-auto-mode
```

2. **Install dependencies**:

```bash
npm install
```

3. **Build the project**:

```bash
npm run build
```

The build runs `tsup` (ESM + CJS), copies bundled rules via `scripts/copy-rules.mjs`, and generates TypeScript declarations.

4. **Link globally** (so OpenCode can load the plugin):

```bash
npm link
```

5. **Verify the installation**:

```bash
npm link opencode-auto-mode
```

### Method 3: Local git clone + direct path

```bash
git clone <repository-url>
cd opencode-auto-mode
npm install
npm run build
```

Reference the plugin path in your OpenCode configuration.

## Configuration Steps

1. Create the config file:

```bash
# On Windows (PowerShell):
$env:USERPROFILE | Join-Path ".config" | Join-Path "opencode" | Out-String

# On macOS/Linux:
echo ~/.config/opencode
```

2. Create `~/.config/opencode/auto-mode.jsonc` with your configuration:

```jsonc
{
  "llm": {
    "provider": "openai",
    "model": "qwen/qwen3.5-9b",
    "timeout": 8000,
  },
  "denyMode": "auto-retry",
  "escalation": {
    "consecutive": 3,
    "total": 20,
  },
  "fallback": {
    "onTimeout": "ask-user",
    "onError": "ask-user",
  },
}
```

> The default LLM endpoint is `http://localhost:18780/v1` (Ollama-compatible). A fallback model is only used if you set `llm.fallbackModel` — no fallback is used by default.

3. See [Configuration Guide](CONFIGURATION.md) for all available options.

## Verification

1. **Check the build**:

```bash
npm run build
```

Verify that the `dist/` directory is created with compiled JavaScript files, and `dist/default-block-rules.jsonc` exists.

2. **Run tests**:

```bash
npm test
```

All tests should pass (unit + integration + property-based tests).

3. **Verify plugin loads**:

Start OpenCode and check for initialization messages:

```
[AutoMode][v1.3.0] PLUGIN INITIALIZED
[AutoMode][v1.3.0] Config loaded: rules=53 exceptions=10 llm=none
```

## Troubleshooting

### "Config file not found" warning

This is normal if you haven't created `~/.config/opencode/auto-mode.jsonc` yet. The plugin uses default configuration until a config file is provided.

### TypeScript compilation errors

Ensure you have the correct Node.js version:

```bash
node --version  # Should be 18+
npm run build
```

### Tests failing after local changes

```bash
npm install
npm run build
npm test
```

### Plugin not loading in OpenCode

1. Check that `dist/index.js` exists
2. Verify the plugin is properly linked (for local installs)
3. Check OpenCode logs for initialization errors

### Config not being read

1. Verify the config file path: `~/.config/opencode/auto-mode.jsonc`
2. Ensure the file uses `.jsonc` extension (supports comments)
3. Check that the JSON is valid (remove any trailing commas or invalid syntax)
4. Check console output for parse error messages

### Default block rules not loading

The default block rules are defined in `src/config/default-block-rules.jsonc` and bundled to `dist/default-block-rules.jsonc` at build time via `scripts/copy-rules.mjs`. If they're not loading:

1. Check that `dist/default-block-rules.jsonc` exists after build
2. Verify the rules file is valid JSONC (no trailing commas, proper comments)
3. Check console for "Errors parsing default block rules" warning
