# Configuration Guide: OpenCode Auto-Mode Plugin

## Config File Location

The plugin reads its configuration from `~/.config/opencode/auto-mode.jsonc` (JSON with Comments).

On Windows this resolves to `%USERPROFILE%\.config\opencode\auto-mode.jsonc`. You can override the directory via the `OPENCODE_CONFIG_DIR` environment variable: `$OPENCODE_CONFIG_DIR/auto-mode.jsonc`.

## Configuration Options

### LLM Provider Configuration

Controls which LLM API is used for classification.

```jsonc
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "timeout": 5000,
  },
}
```

| Field           | Type                                     | Default                       | Description                                                                                |
| --------------- | ---------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `provider`      | `"anthropic"` \| `"openai"` \| `"local"` | `"anthropic"`                 | LLM provider name (informational)                                                          |
| `model`         | string                                   | `"claude-sonnet-4-20250514"`  | Model name for classification                                                              |
| `timeout`       | number                                   | `5000`                        | API request timeout in milliseconds                                                        |
| `baseUrl`       | string                                   | `"http://localhost:18780/v1"` | Ollama-compatible API base URL                                                             |
| `apiKey`        | string                                   | `""`                          | API key (if required by provider)                                                          |
| `fallbackModel` | string                                   | `""`                          | Secondary model — used on first-model failure (timeout, 5xx, etc.) — empty string disables |

The default endpoint is `http://localhost:18780/v1` (Ollama-compatible chat completions). The fallback model `mistral-large-latest` is used automatically when the primary model times out or returns a retryable HTTP error.

**Example - Local model**:

```jsonc
{
  "llm": {
    "provider": "openai",
    "model": "qwen/qwen3.5-9b",
    "timeout": 30000,
    "fallbackModel": "local-model",
  },
}
```

> **Important**: `model` must be configured as a non-empty string in your config for LLM classification to run. If omitted, the plugin returns `ask` instead of calling the LLM.

### Deny Mode

Controls what happens when an action is blocked by a **critical-severity** rule. Denials route through `DenyAndContinueService`:

```jsonc
{
  "denyMode": "auto-retry",
}
```

| Value          | Behavior                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `"auto-retry"` | Command is denied with message: "Action blocked by auto-mode rule, please find a safer approach" |
| `"ask-user"`   | Returns `ask` to the user: "Blocked — user confirmation required"                                |
| `"both"`       | Auto-deny until `escalation.consecutive` threshold is reached, then switches to `ask-user`       |

In `both` mode, `DenyAndContinueService` checks `sessionState.getDenialCounters().consecutive` against `escalation.consecutive` (default 3). If the threshold is met or exceeded, the denial escalates to an ask rather than auto-retry.

### Escalation Thresholds

Configure when the system escalates to user intervention.

```jsonc
{
  "escalation": {
    "consecutive": 3,
    "total": 20,
  },
}
```

| Field         | Type   | Default | Description                                      |
| ------------- | ------ | ------- | ------------------------------------------------ |
| `consecutive` | number | `3`     | Consecutive denials before escalation            |
| `total`       | number | `20`    | Total denials (across session) before escalation |

**Example - More lenient escalation**:

```jsonc
{
  "escalation": {
    "consecutive": 5,
    "total": 50,
  },
}
```

### Trust Boundary Configuration

Define protected paths and commands that are always blocked.

```jsonc
{
  "trustBoundary": {
    "protectedPaths": ["/etc/", "~/.ssh/", "~/.env"],
    "protectedCommands": ["sudo", "su", "chmod 777", "iptables", "dd if="],
  },
}
```

| Field               | Type     | Default                                                                                               | Description                             |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `protectedPaths`    | string[] | `[ "/etc/", "~/.ssh/", "~/.env", "C:\\Windows\\", "%USERPROFILE%\\.ssh\\", "%USERPROFILE%\\.env\\" ]` | File/directory paths that are protected |
| `protectedCommands` | string[] | `[ "sudo", "su", "chmod 777", "iptables", "rm -rf", "mkfs", "dd if=", "fdisk" ]`                      | Commands that are protected             |

**Matching behavior:**

- **Paths**: Uses boundary-aware matching — `~/.env` does NOT match `~/.env.production`; a trailing `/` means prefix match (e.g., `/etc/` matches `/etc/hosts`).
- **Commands**: Matched per shell segment (compound commands split on `;`, `|`, `` ` ``, `$(`, newlines). `sudo && echo hi` would still trigger the `sudo` protected command.

**Example - Extended trust boundary**:

```jsonc
{
  "trustBoundary": {
    "protectedPaths": [
      "/etc/",
      "~/.ssh/",
      "~/.env",
      "/var/run/secrets",
      "/root/",
    ],
    "protectedCommands": [
      "sudo",
      "su",
      "chmod 777",
      "iptables",
      "modprobe",
      "insmod",
      "dd if=",
    ],
  },
}
```

### Agent Exclusion List

Agents in this list skip the full classifier evaluation.

```jsonc
{
  "excludedAgents": ["explore", "research"],
}
```

| Field            | Type     | Default                   | Description                                        |
| ---------------- | -------- | ------------------------- | -------------------------------------------------- |
| `excludedAgents` | string[] | `["explore", "research"]` | List of agent names to exclude from classification |

## Session & Agent Tracking

The plugin tracks sessions and agents with bounded maps (LRU eviction):

- **Session tracking**: Bounded at 200 entries. `session.created` events create/reset the denial state for a session; `session.deleted` events clean up state.
- **Agent tracking**: Bounded at 200 entries. Per-session agent name is stored at `session.created` time.
- **Per-agent allow-list**: OpenCode permission allow-lists are cached per-agent name, so permissions do not leak across agents.

## `# BLOCKED` Prefix

Commands starting with `# BLOCKED` on the first line are auto-denied — **only** for single-line commands. Multi-line commands (containing newlines) with `# BLOCKED` are still fully classified.

### Fallback Behavior

Controls behavior when the LLM API fails.

```jsonc
{
  "fallback": {
    "onTimeout": "ask-user",
    "onError": "ask-user",
  },
}
```

| Field       | Type                                  | Default      | Description                        |
| ----------- | ------------------------------------- | ------------ | ---------------------------------- |
| `onTimeout` | `"ask-user"` \| `"allow"` \| `"deny"` | `"ask-user"` | Behavior when LLM times out        |
| `onError`   | `"ask-user"` \| `"allow"` \| `"deny"` | `"ask-user"` | Behavior when LLM returns an error |

> **Limitation**: `fallback.onError: 'allow'` **cannot override the secret guard**. Commands containing secret paths/keywords (`.ssh`, `.env`, `api_key=...`, `Bearer <token>`, etc.) always result in `ask` regardless of fallback settings.

> **LLM retry semantics**: HTTP errors 408, 429, 500, 502, 503, 504 trigger an automatic retry with the fallback model. Non-retryable errors go directly to `onError`. LLM response parse errors (`LlmParseError`) are never retried.

**Example - Safe failure mode**:

```jsonc
{
  "fallback": {
    "onTimeout": "deny",
    "onError": "deny",
  },
}
```

**Example - Permissive failure mode**:

```jsonc
{
  "fallback": {
    "onTimeout": "allow",
    "onError": "allow",
  },
}
```

### Injection Protection

Controls prompt-injection scanning of Bash tool output. Enabled by default.

```jsonc
{
  "injection": {
    "enabled": true,
    "scanToolResults": true,
    "scanUserMessages": false,
    "customPatterns": [
      { "pattern": "YOUR_CUSTOM_MARKER", "description": "Describe the marker" },
    ],
  },
}
```

| Field               | Type                                                          | Default | Description                                                    |
| ------------------- | ------------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| `enabled`           | boolean                                                       | `true`  | Master switch for all injection scanning                       |
| `scanToolResults`   | boolean                                                       | `true`  | Scan Bash tool output for injection patterns                   |
| `scanUserMessages`  | boolean                                                       | `false` | Reserved. Not wired to any OpenCode hook (no user-message hook exists), so it has no effect. Kept for backward compatibility. |
| `customPatterns`    | `Array<{ pattern: string; description: string }>`             | `[]`    | Extra patterns (matched case-insensitively) to flag for review |

Custom patterns are compiled into regexes and matched against scanned content. When a pattern matches, the tool result is flagged for manual review. The pattern is only applied if it compiles to a valid regex and is not rejected by the ReDoS guard.

## Default Block Rules

The plugin ships with 52 default block rules (BR-001 through BR-052) defined in `src/config/default-block-rules.jsonc`, plus 10 allow exceptions (AE-001 through AE-010). The JSONC file is the authoritative source — it is shipped to `dist/config/` at build time via the `scripts/copy-rules.mjs` script.

### Destruction (11 rules)

| Rule ID | Pattern                                     | Description                                     | Severity                           |
| ------- | ------------------------------------------- | ----------------------------------------------- | ---------------------------------- |
| BR-001  | `rm\s+-{1,2}[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*`  | Recursive force deletion (incl. -fr, -Rf)       | critical                           |
| BR-002  | `docker\s+rm\s+-f\s+`                       | Docker force removal                            | high                               |
| BR-003  | `docker\s+rmi\s+-f\s+`                      | Docker image force removal                      | high                               |
| BR-004  | `docker\s+system\s+prune\s+-f`              | Docker system prune force                       | medium                             |
| BR-005  | `rm\s+-rf\s+node_modules`                   | Remove node_modules force                       | medium                             |
| BR-039  | `rm\s+-{1,2}[a-zA-Z]*r[a-zA-Z]*\s+[/.]\s*$` | Recursive deletion of root or current directory | critical                           |
| BR-040  | `rm\s+--recursive                           | --force`                                        | Long-form recursive force deletion | critical |
| BR-041  | `xargs\s+rm\s+`                             | Deletion via xargs                              | high                               |
| BR-042  | `find\s+.*-delete`                          | Recursive deletion via find -delete             | high                               |
| BR-043  | `dd\s+if=.*of=/dev/`                        | Raw disk write via dd                           | critical                           |
| BR-044  | `mkfs`                                      | Filesystem formatting                           | critical                           |

### System Configuration (9 rules)

| Rule ID | Pattern                                | Description                             | Severity |
| ------- | -------------------------------------- | --------------------------------------- | -------- |
| BR-006  | `/etc/`                                | System configuration path access        | high     |
| BR-007  | `/etc/hosts`                           | Hosts file modification                 | high     |
| BR-008  | `sudo\s+`                              | Privilege escalation via sudo           | critical |
| BR-009  | `sudo\s+chmod\s+`                      | Sudo chmod execution                    | critical |
| BR-010  | `chmod\s+777`                          | World-writable permissions              | high     |
| BR-011  | `systemctl\s+(restart\|stop\|disable)` | System service modification             | medium   |
| BR-050  | `chmod\s+-{1,2}[a-zA-Z]*R[a-zA-Z]*\s+` | Recursive chmod                         | medium   |
| BR-051  | `chown\s+-{1,2}[a-zA-Z]*R[a-zA-Z]*\s+` | Recursive chown                         | medium   |
| BR-052  | `chmod\s+7\s+7\s+7`                    | Spaced octal world-writable permissions | high     |

### Security & Credentials (5 rules)

| Rule ID | Pattern            | Description                   | Severity |
| ------- | ------------------ | ----------------------------- | -------- |
| BR-012  | `~/.ssh/`          | SSH key directory access      | critical |
| BR-013  | `~/.env`           | Environment file access       | high     |
| BR-014  | `echo\s+\$[A-Z_]+` | Environment variable exposure | high     |
| BR-015  | `cat\s+.*id_rsa`   | SSH private key exposure      | critical |
| BR-031  | `openssl\s+`       | SSL certificate manipulation  | medium   |

### Execution — Soft & High-Risk (11 rules)

Rules BR-016 through BR-023 are upgraded to severity `soft`, falling through to LLM classification instead of immediate deny/ask. BR-047 through BR-049 are high-severity remote code execution rules.

| Rule ID | Pattern                         | Description                                  | Severity |
| ------- | ------------------------------- | -------------------------------------------- | -------- |
| BR-016  | `python.*-c.*import\s+os`       | Python OS module import via inline execution | medium   |
| BR-017  | `subprocess\s*\(`               | Subprocess execution via inline code         | medium   |
| BR-018  | `\.system\s*\(`                 | System call execution via inline code        | medium   |
| BR-019  | `\.exec\s*\(`                   | Exec call via inline code                    | medium   |
| BR-020  | `\.spawn\s*\(`                  | Spawn process call via inline code           | medium   |
| BR-021  | `\.fork\s*\(`                   | Fork process call via inline code            | low      |
| BR-022  | `\.child_process`               | Child process creation via inline code       | low      |
| BR-023  | `\.Popen\s*\(`                  | Python Popen process via inline code         | medium   |
| BR-047  | `curl\s+.*\|\s*(bash\|sh)`      | Remote code execution via curl pipe to shell | high     |
| BR-048  | `wget\s+.*\|\s*(bash\|sh)`      | Remote code execution via wget pipe to shell | high     |
| BR-049  | `docker\s+run\s+.*--privileged` | Privileged container execution               | high     |

### Network & Database (6 rules)

| Rule ID | Pattern                          | Description                  | Severity                         |
| ------- | -------------------------------- | ---------------------------- | -------------------------------- |
| BR-032  | `iptables`                       | Firewall modification        | high                             |
| BR-033  | `ufw`                            | Ubuntu firewall modification | high                             |
| BR-034  | `nmap`                           | Network port scanning        | medium                           |
| BR-035  | `DROP\s+TABLE`                   | Database table destruction   | critical                         |
| BR-036  | `DELETE\s+FROM\b(?!.+\bWHERE\b)` | DELETE without WHERE clause  | critical                         |
| BR-037  | `TRUNCATE\s+`                    | Database table truncation    | high                             |

### Version Control (2 rules)

| Rule ID | Pattern                                                          | Description                        | Severity |
| ------- | ---------------------------------------------------------------- | ---------------------------------- | -------- |
| BR-024  | `git\s+reset\s+(--hard\|--soft)`                                 | Git reset (potential history loss) | medium   |
| BR-038  | `git\s+push\s+(?:-f\b\|--force\b)\|git\s+push\s+.*\s--force\b`   | Git force push (history rewrite)   | high     |

### Cloud (3 rules)

| Rule ID | Pattern                                   | Description                  | Severity |
| ------- | ----------------------------------------- | ---------------------------- | -------- |
| BR-025  | `kubectl\s+delete`                        | Kubernetes resource deletion | high     |
| BR-026  | `iam:(CreateUser\|DeleteRole\|PutPolicy)` | AWS IAM modification         | critical |
| BR-027  | `aws\s+iam\s+`                            | AWS IAM command execution    | high     |

### System Administration (5 rules)

| Rule ID | Pattern        | Description           | Severity |
| ------- | -------------- | --------------------- | -------- |
| BR-028  | `crontab\s+-e` | Cron job modification | medium   |
| BR-029  | `insmod\s+`    | Kernel module loading | high     |
| BR-030  | `modprobe\s+`  | Kernel module loading | high     |
| BR-045  | `\bshutdown\b` | System shutdown       | high     |
| BR-046  | `\breboot\b`   | System reboot         | high     |

## Default Allow Exceptions

The plugin ships with 10 allow exceptions (AE-001 through AE-010). All match on every shell segment of a compound command; if an exception only matches one segment, the compound command is **not** allowed.

| Rule ID | Pattern                                 | Description                                            |
| ------- | --------------------------------------- | ------------------------------------------------------ |
| AE-001  | `rm\s+-rf\s+node_modules\s+--force\s*$` | Allow rm node_modules with explicit --force (anchored) |
| AE-002  | `chmod\s+644`                           | Allow chmod 644                                        |
| AE-003  | `chmod\s+755`                           | Allow chmod 755                                        |
| AE-004  | `cat\s+\.\.\/\.env\.example`            | Allow reading .env.example templates                   |
| AE-005  | `openssl\s+version`                     | Allow checking OpenSSL version                         |
| AE-006  | `git\s+push\s+--force-with-lease`       | Allow safe force push with lease                       |
| AE-007  | `systemctl\s+status`                    | Allow checking service status (read-only)              |
| AE-008  | `docker\s+ps`                           | Allow listing running containers (read-only)           |
| AE-009  | `aws\s+iam\s+get-`                      | Allow AWS IAM read operations                          |
| AE-010  | `nmap\s+-sV\s+localhost`                | Allow local version scan on localhost                  |

> **Compound commands**: An allow exception must match **every shell segment** (split on `;`, `|`, `` ` ``, `$(`, newlines). An allow exception that only matches one segment (e.g., `openssl version && rm -rf /`) returns `ask` instead of `allow`.

## Adding Custom Block Rules

Add custom block rules to your `auto-mode.jsonc` config file:

```jsonc
{
  "blockRules": [
    {
      "id": "BR-CUSTOM-001",
      "type": "pattern",
      "pattern": "dangerous-pattern",
      "category": "custom",
      "description": "Description of custom rule",
      "severity": "high",
      "enabled": true,
    },
  ],
}
```

Rule fields:

| Field         | Type    | Required | Description                                                        |
| ------------- | ------- | -------- | ------------------------------------------------------------------ |
| `id`          | string  | Yes      | Unique rule identifier (e.g., "BR-CUSTOM-001")                     |
| `type`        | string  | Yes      | Pattern matching type: `"pattern"`                                 |
| `pattern`     | string  | Yes      | Regex or substring pattern. Use `regex:` prefix for regex patterns |
| `category`    | string  | Yes      | Rule category: `"custom"`, `"security"`, `"destruction"`, etc.     |
| `description` | string  | Yes      | Human-readable description of the rule                             |
| `severity`    | string  | Yes      | Rule severity: `"critical"`, `"high"`, `"medium"`, `"low"`         |
| `enabled`     | boolean | Yes      | Whether the rule is active                                         |

**Example - Regex pattern for blocking Python destructive operations**:

```jsonc
{
  "blockRules": [
    {
      "id": "BR-PYTHON-001",
      "type": "pattern",
      "pattern": "regex:os\\.remove\\s*\\(",
      "category": "custom",
      "description": "Block Python os.remove() calls",
      "severity": "high",
      "enabled": true,
    },
  ],
}
```

## Adding Custom Allow Exceptions

Add custom allow exceptions that override block rules:

```jsonc
{
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

Exception fields:

| Field         | Type    | Required | Description                                         |
| ------------- | ------- | -------- | --------------------------------------------------- |
| `id`          | string  | Yes      | Unique exception identifier (e.g., "AE-CUSTOM-001") |
| `type`        | string  | Yes      | Pattern matching type: `"pattern"`                  |
| `pattern`     | string  | Yes      | Regex or substring pattern                          |
| `description` | string  | Yes      | Human-readable description                          |
| `enabled`     | boolean | Yes      | Whether the exception is active                     |

## Complete Example Configuration

```jsonc
{
  // LLM Provider Configuration
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "timeout": 5000,
  },

  // Deny Mode: auto-retry, ask-user, or both
  "denyMode": "auto-retry",

  // Escalation Thresholds
  "escalation": {
    "consecutive": 3,
    "total": 20,
  },

  // Trust Boundary Configuration
  "trustBoundary": {
    "protectedPaths": ["/etc/", "~/.ssh/", "~/.env"],
    "protectedCommands": ["sudo", "su", "chmod 777", "iptables"],
  },

  // Agent Exclusion List
  "excludedAgents": ["explore", "research"],

  // Fallback Behavior
  "fallback": {
    "onTimeout": "ask-user",
    "onError": "ask-user",
  },

  // Soft rules — these fall through to LLM instead of immediate deny/ask
  "softRules": [
    "BR-016",
    "BR-017",
    "BR-018",
    "BR-019",
    "BR-020",
    "BR-021",
    "BR-022",
    "BR-023",
  ],

  // Custom block rules (merged with 52 default rules)
  "blockRules": [
    {
      "id": "BR-CUSTOM-001",
      "type": "pattern",
      "pattern": "regex:python\\s+.*\\s+-c\\s+.*os\\.remove",
      "category": "custom",
      "description": "Block Python one-liners that remove files",
      "severity": "high",
      "enabled": true,
    },
  ],

  // Custom allow exceptions (override block rules)
  "allowExceptions": [
    {
      "id": "AE-CUSTOM-001",
      "type": "pattern",
      "pattern": "safe-cleanup-script",
      "description": "Allow safe cleanup script",
      "enabled": true,
    },
  ],
}
```

## Config Reload

The plugin detects config file changes via a content SHA-1 signature (not mtime). If the file is unparseable mid-write, the reload is deferred until the next classification call. A JSONC pre-validation step verifies the content before computing the signature.

## Secret Guard

The secret guard runs **before** all other checks. It detects:

- **Secret file paths**: `.env`, `.ssh`, `.npmrc`, `.aws`, credentials, `id_rsa`, `id_ed25519`, etc.
- **Secret keywords**: `api_key`, `secrets`, `tokens`, `passwords`
- **Embedded credentials**: `client_secret=...`, `api_key=...`, `Bearer <token>`, URL credentials (`https://user:pass@host`)
- **Secret flags**: `--token=...`, `--password=...`, `--auth=...`
- **Obfuscated paths**: Double obfuscation — first quotes/backslashes are stripped, then patterns are checked. `cat "$HOME/.en"v` and `~/.ss\h/id_rsa` are still caught.

Any secret guard hit returns `ask` (never auto-allowed), regardless of `fallback.onError: 'allow'`.

## Prompt Sanitization

Before sending a command (and any file content) to the LLM, `sanitizeForPrompt()` applies three transformations:

1. **Code fence breaking**: ` ``` ` is replaced with `` ` ` ` `` to prevent the command from being interpreted as a code fence by the LLM.
2. **Horizontal rule breaking**: Lines consisting of three or more dashes (`---`) are replaced with `---`.
3. **Control/zero-width character stripping**: All characters in ranges `\u0000-\u001F`, `\u007F-\u009F`, zero-width/bidi (`\u200B-\u200F`, `\u202A-\u202E`, `\u2060-\u206F`, `\uFEFF`) are removed from both the command and file contents.

The classifier prompt also includes an **"UNTRUSTED data"** warning telling the LLM to ignore any instructions inside the command/file content and treat them strictly as data to evaluate.

## Pattern Matching

| Pattern type                  | Behavior                                                    |
| ----------------------------- | ----------------------------------------------------------- |
| `regex:...` prefix            | Exact regex against the entire command (case-insensitive)   |
| Plain substring               | `command.includes(pattern)` — fast, no regex interpretation |
| Glob (contains `*`, `[`, `{`) | Converted to regex at normalization time                    |

Invalid regex patterns are treated as substring matches. Regex patterns matching ReDoS vulnerability indicators (nested quantifiers, repeated alternation, or very long) are rejected for safety.

## Rule Precedence

| Order | Check                                                 | Result                                   |
| ----- | ----------------------------------------------------- | ---------------------------------------- |
| 1     | **Trust boundary** — protected paths & commands       | Immediate `blocked`                      |
| 2     | **Allow exceptions** — every shell segment must match | `allowed` (blocks block rule evaluation) |
| 3a    | **Block rules — critical** severity                   | `deny`                                   |
| 3b    | **Block rules — soft** severity                       | Falls through to LLM classification      |
| 3c    | **Block rules — high/medium/low** severity            | `ask` (unless opencode allow-listed)     |
| 4     | **Opencode permission allow-list** skip               | `allow` (bypasses classifier)            |
| 5     | **LLM classification**                                | Determined by LLM model                  |

> **Compound commands**: Shell segments (`;`, `\|`, `` ` ``, `$(`, newlines) are checked individually. A trusted command like `openssl version && rm -rf /` will still be blocked because the `rm -rf /` segment hits a critical rule.

## Example: Rule Evaluation Flow

```
Tool Call: "rm -rf /tmp/test"

1. Trust Boundary? No (no trusted paths matched)
2. Allow Exception? No (no exceptions matched)
3. Block Rules? BR-001 matches "rm -rf" -> BLOCKED
Result: Action is denied

---

Tool Call: "rm -rf node_modules --force"

1. Trust Boundary? No
2. Allow Exception? AE-001 matches all segments -> ALLOWED
Result: Action is allowed (exception blocks rule evaluation)

---

Tool Call: "openssl version && rm -rf /tmp/test"

1. Allow Exception? AE-005 matches "openssl version" but NOT "rm -rf /tmp/test"
2. Block Rules? BR-001 matches "rm -rf /tmp/test" segment -> BLOCKED
Result: Action is asked (compound command, exception doesn't cover all segments)
```
