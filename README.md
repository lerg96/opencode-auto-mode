# OpenCode Auto-Mode Plugin

Automatic command approval for OpenCode, implementing LLM-based two-stage classification pipeline with configurable block rules, escalation thresholds, and fallback behaviors.

## Features

- **Two-Stage Classification**: Fast pattern-matching filter (Stage 1) + LLM semantic classification (Stage 2)
- **53 Default Block Rules**: Covers destructive operations, system configuration, security, credentials, cloud, database, version control, and more
- **10 Allow Exceptions**: Safe carve-outs for common developer actions (compound commands require all-segment match)
- **Secret Guard**: Detects embedded credentials, Bearer tokens, URL credentials, obfuscated paths; always returns `ask` regardless of fallback settings
- **Configurable Fallback**: ask-user, allow, or deny on LLM errors/timeouts (with automatic retry on HTTP 408/429/5xx)
- **Escalation System**: Consecutive and total denial thresholds with user intervention
- **Per-Segment Trust Boundary**: Protected commands and paths matched per shell segment; compound commands (`&&`, `|`, `$(`, newlines) checked individually
- **Config Reload**: Content SHA-1 signature-based detection (not mtime); defers on unparseable files
- **Deny-and-Continue**: Auto-retry, ask-user, or both modes
- **Prompt Injection Detection**: Zero-width normalization, fenced command wrapping, file content sanitization
- **Per-Agent Allow-List**: OpenCode permission allow-lists cached per-agent (no cross-agent leakage)
- **Telemetry Dataset**: Optional JSONL export of classifier decisions + user outcomes (raw LLM verdict + full reason, with shared `id` across classification/approval) for fine-tuning a small command classifier
- **Extensible Rules**: Add custom block rules and allow exceptions via config
- **Property-Based Testing**: Mathematical guarantees on pure function behavior

## Installation

Add the plugin to your `opencode.jsonc` (or `~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@lerg96/opencode-auto-mode"],
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

After installation, create a config file at `~/.config/opencode/auto-mode.jsonc`:

```jsonc
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "timeout": 5000,
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

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the complete configuration guide.

## Block Rules Overview

The plugin ships with 53 default block rules covering:

| Category         | Examples                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Destruction      | `rm -rf`, `docker rm -f`, `docker system prune -f`, `DROP TABLE`, `dd if=`, `mkfs`, `xargs rm`     |
| System Config    | `sudo`, `sudo chmod`, `systemctl restart/stop/disable`, `/etc/`, `chmod 777`, recursive `chmod -R` |
| Security         | `~/.ssh/`, `~/.env`, `cat .*id_rsa`, `echo $VAR`                                                   |
| Execution (soft) | `python -c import os`, `subprocess()`, `.system()`, `.Popen()`                                     |
| Execution (high) | `curl \| sh`, `wget \| sh`, `docker run --privileged`                                              |
| Network          | `openssl`, `iptables`, `ufw`, `nmap`                                                               |
| Database         | `DELETE FROM` (no WHERE), `TRUNCATE`, `DROP TABLE`                                                 |
| Version Control  | `git -f push`, `git push --force`, `git reset --hard`                                              |
| Cloud            | `kubectl delete`, `iam:...`, `aws iam`                                                             |
| System Admin     | `crontab -e`, `insmod`, `modprobe`, `shutdown`, `reboot`                                           |

Plus 10 allow exceptions for safe operations like `chmod 644`, `docker ps`, `systemctl status`, etc.

All rules are matched per shell segment for compound commands. Allow exceptions must match every segment to exempt a compound command.

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
      "enabled": true,
    },
  ],
  "allowExceptions": [
    {
      "id": "AE-CUSTOM-001",
      "type": "pattern",
      "pattern": "safe-operation",
      "description": "Allow safe operation",
      "enabled": true,
    },
  ],
}
```

Custom rules are merged with the 53 default rules. Allow exceptions take precedence over all block rules.

## Architecture

The plugin uses a modular monolith architecture with:

- **Secret Guard**: Runs before all checks; detects secret paths, credentials, Bearer tokens, obfuscated paths — always returns `ask`
- **ConfigManager**: Loads/reloads config via SHA-1 signature; applies defaults via `structuredClone`
- **OpenCode Allow-List**: Bypasses the classifier for explicitly allowed actions (opencode.jsonc permissions, cached in-memory per session)
- **PatternMatcher**: Regex and substring matching with ReDoS protection and ReDoS-safe exception segment checking
- **RuleEvaluator**: Trust boundary → allow exceptions → block rules evaluation flow
- **LlmClient**: Ollama-compatible LLM calls with HTTP error retry (408/429/5xx) and structured `LlmHttpError`/`LlmParseError` exceptions
- **SessionState**: In-memory session state management (bounded at 200, LRU)
- **DenyAndContinueService**: Configurable deny modes
- **EscalationService**: Denial threshold monitoring
- **InjectionProbe/ProtectionService**: Prompt injection detection with zero-width normalization and `lastIndex` reset

## License

MIT
