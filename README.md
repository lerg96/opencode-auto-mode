# OpenCode Auto-Mode Plugin

Automatic command approval for OpenCode, implementing LLM-based two-stage classification pipeline with configurable block rules, escalation thresholds, and fallback behaviors.

## Features

- **Two-Stage Classification**: Fast single-token filter (Stage 1) + chain-of-thought reasoning (Stage 2)
- **30 Default Block Rules**: Covers destructive operations, system configuration, security, credentials, and more
- **10 Allow Exceptions**: Safe carve-outs for common developer actions
- **Configurable Fallback**: ask-user, allow, or deny on LLM errors/timeouts
- **Escalation System**: Consecutive and total denial thresholds with user intervention
- **Deny-and-Continue**: Auto-retry, ask-user, or both modes
- **Prompt Injection Detection**: Scans tool output for hidden prompts, jailbreaks, and embedded commands
- **Trust Boundaries**: Configurable protected paths and commands
- **Agent Exclusion List**: Skip classification for specific agents
- **Extensible Rules**: Add custom block rules and allow exceptions via config
- **Property-Based Testing**: Mathematical guarantees on pure function behavior

## Installation

Add the plugin to your `opencode.jsonc` (or `~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "@lerg96/opencode-auto-mode"
  ]
}
```

OpenCode will automatically download and activate the plugin on startup.

### Local Development Install

```bash
git clone https://github.com/lerg96/opencode-auto-mode.git
cd opencode-auto-mode
npm install
npm run build
```

See [docs/SETUP.md](docs/SETUP.md) for detailed installation instructions.

## Configuration

After installation, create a config file at `~/.opencode/auto-mode.jsonc`:

```jsonc
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "timeout": 5000
  },
  "denyMode": "auto-retry",
  "escalation": {
    "consecutive": 3,
    "total": 20
  },
  "fallback": {
    "onTimeout": "ask-user",
    "onError": "ask-user"
  }
}
```

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the complete configuration guide.

## Block Rules Overview

The plugin ships with 30 default block rules covering:

| Category | Examples |
|----------|----------|
| Destruction | `rm -rf`, `docker rm -f`, `DROP TABLE`, `dd if=`, `mkfs` |
| Permissions | `chmod 777` |
| Secrets | `.ssh/id_(rsa|dsa|ecdsa|ed25519)`, NPM auth tokens, AWS keys |
| Execution | `curl \| bash`, `wget \| bash`, `eval()`, `subprocess()`, `system()`, `cron -e`, `systemctl` |
| Collaboration | `git push --force` |
| Privilege | `.sudo` |
| Security | `.iptables -F` |

Plus 10 allow exceptions for safe operations like `chmod 644`, `docker ps`, `systemctl status`, etc.

## Adding Custom Rules

Add custom block rules in your `auto-mode.jsonc`:

```jsonc
{
  "blockRules": [
    {
      "id": "BR-CUSTOM-001",
      "type": "pattern",
      "pattern": "dangerous-command",
      "category": "custom",
      "description": "Block custom dangerous command",
      "severity": "high",
      "enabled": true
    }
  ],
  "allowExceptions": [
    {
      "id": "AE-CUSTOM-001",
      "type": "pattern",
      "pattern": "safe-operation",
      "description": "Allow safe operation",
      "enabled": true
    }
  ]
}
```

Custom rules are merged with the 30 default rules. Allow exceptions take precedence over all block rules.

## Architecture

The plugin uses a modular monolith architecture with:

- **Permission Pre-Checker**: Bypasses classifier for explicitly allowed actions
- **TranscriptClassifier**: Two-stage LLM-based classification pipeline
- **RuleEvaluator**: Pattern-based rule evaluation with LLM fallback
- **LLMProviderAbstraction**: Supports Anthropic, OpenAI, and local models
- **SessionState**: In-memory session state management
- **ClassificationService**: Full pipeline orchestration
- **DenyAndContinueService**: Configurable deny modes
- **EscalationService**: Denial threshold monitoring
- **InjectionProbe**: Prompt injection detection
- **InjectionProtectionService**: Injection scanning orchestration

## License

MIT
