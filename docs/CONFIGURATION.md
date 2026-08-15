# Configuration Guide: OpenCode Auto-Mode Plugin

## Config File Location

The plugin reads its configuration from `~/.opencode/auto-mode.jsonc` (JSON with Comments).

## Configuration Options

### LLM Provider Configuration

Controls which LLM API is used for classification.

```jsonc
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "timeout": 5000
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `"anthropic"` \| `"openai"` | `"anthropic"` | LLM provider to use |
| `model` | string | `"claude-sonnet-4-20250514"` | Model name for classification |
| `timeout` | number | `5000` | API request timeout in milliseconds |

**Example - OpenAI provider**:

```jsonc
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4",
    "timeout": 10000
  }
}
```

**Example - Local model**:

```jsonc
{
  "llm": {
    "provider": "openai",
    "model": "local-model",
    "timeout": 30000,
    "baseUrl": "http://localhost:1234/v1"
  }
}
```

### Deny Mode

Controls what happens when an action is blocked by the classifier.

```jsonc
{
  "denyMode": "auto-retry"
}
```

| Value | Behavior |
|-------|----------|
| `"auto-retry"` | Agent is denied and can retry with a modified action |
| `"ask-user"` | User is prompted for manual approval/denial |
| `"both"` | Auto-retry until escalation threshold, then ask user |

### Escalation Thresholds

Configure when the system escalates to user intervention.

```jsonc
{
  "escalation": {
    "consecutive": 3,
    "total": 20
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `consecutive` | number | `3` | Consecutive denials before escalation |
| `total` | number | `20` | Total denials (across session) before escalation |

**Example - More lenient escalation**:

```jsonc
{
  "escalation": {
    "consecutive": 5,
    "total": 50
  }
}
```

### Trust Boundary Configuration

Define protected paths and commands that are always blocked.

```jsonc
{
  "trustBoundary": {
    "protectedPaths": ["/etc/", "~/.ssh/", "~/.env"],
    "protectedCommands": ["sudo", "su", "chmod 777", "iptables"]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `protectedPaths` | string[] | `[]` | File/directory paths that are protected |
| `protectedCommands` | string[] | `[]` | Commands that are protected |

Trust boundary rules have the highest precedence and always override allow exceptions.

**Example - Extended trust boundary**:

```jsonc
{
  "trustBoundary": {
    "protectedPaths": ["/etc/", "~/.ssh/", "~/.env", "/var/run/secrets", "/root/"],
    "protectedCommands": ["sudo", "su", "chmod 777", "iptables", "modprobe", "insmod", "dd if="]
  }
}
```

### Agent Exclusion List

Agents in this list skip the full classifier evaluation.

```jsonc
{
  "excludedAgents": ["explore", "research"]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `excludedAgents` | string[] | `["explore"]` | List of agent names to exclude from classification |

### Fallback Behavior

Controls behavior when the LLM API fails.

```jsonc
{
  "fallback": {
    "onTimeout": "ask-user",
    "onError": "ask-user"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `onTimeout` | `"ask-user"` \| `"allow"` \| `"deny"` | `"ask-user"` | Behavior when LLM times out |
| `onError` | `"ask-user"` \| `"allow"` \| `"deny"` | `"ask-user"` | Behavior when LLM returns an error |

**Example - Safe failure mode**:

```jsonc
{
  "fallback": {
    "onTimeout": "deny",
    "onError": "deny"
  }
}
```

**Example - Permissive failure mode**:

```jsonc
{
  "fallback": {
    "onTimeout": "allow",
    "onError": "allow"
  }
}
```

## Default Block Rules

The plugin ships with 30 default block rules (BR-001 through BR-030), organized by category:

### Destruction
| Rule ID | Pattern | Description | Severity |
|---------|---------|-------------|----------|
| BR-001 | `rm\s+-rf\s+` | Recursive force deletion | critical |
| BR-002 | `docker\s+rm\s+-f\s+` | Docker force removal | high |
| BR-005 | `DROP\s+TABLE` | Database table deletion | critical |
| BR-013 | `dd\s+if=` | Disk image write (dd) | critical |
| BR-014 | `mkfs` | Filesystem creation (format disk) | critical |

### Permissions
| Rule ID | Pattern | Description | Severity |
|---------|---------|-------------|----------|
| BR-003 | `chmod\s+777` | World-writable permissions | high |

### Secrets
| Rule ID | Pattern | Description | Severity |
|---------|---------|-------------|----------|
| BR-004 | `\.ssh\s+id_(rsa|dsa|ecdsa|ed25519)` | Private key access | critical |
| BR-009 | `\.npmrc.*_authToken` | NPM authentication token | high |
| BR-010 | `AWS_SECRET_ACCESS_KEY` | AWS secret access key | critical |

### Execution
| Rule ID | Pattern | Description | Severity |
|---------|---------|-------------|----------|
| BR-006 | `curl.*\|\s*(sh|bash)` | Remote script execution | critical |
| BR-007 | `wget.*\|\s*(sh|bash)` | Remote script download and execute | critical |
| BR-008 | `eval\s*\(` | Code evaluation | high |
| BR-015 | `\.nc\s+.*-e\s` | Netcat reverse shell | critical |
| BR-016 | `python.*-c.*import\s+os` | Python OS module import | medium |
| BR-017 | `subprocess\s*\(` | Subprocess execution | medium |
| BR-018 | `\.system\s*\(` | System call execution | medium |
| BR-019 | `\.exec\s*\(` | Exec call | medium |
| BR-020 | `\.spawn\s*\(` | Spawn process | medium |
| BR-021 | `\.fork\s*\(` | Fork process | low |
| BR-022 | `\.child_process` | Child process creation | low |
| BR-023 | `\.Popen\s*\(` | Python Popen process | medium |
| BR-024 | `\.nohup\s` | Nohangup execution | low |
| BR-025 | `\.screen\s` | Screen session creation | low |
| BR-026 | `\.tmux\s` | Tmux session creation | low |
| BR-027 | `\.cron\s+-e` | Cron job editing | medium |
| BR-028 | `\.systemctl\s+start` | System service start | medium |
| BR-029 | `\.systemctl\s+enable` | System service enable | medium |

### Collaboration
| Rule ID | Pattern | Description | Severity |
|---------|---------|-------------|----------|
| BR-011 | `git push --force` | Forced git push | medium |

### Privilege
| Rule ID | Pattern | Description | Severity |
|---------|---------|-------------|----------|
| BR-012 | `\.sudo` | Sudo escalation | medium |

### Security
| Rule ID | Pattern | Description | Severity |
|---------|---------|-------------|----------|
| BR-030 | `\.iptables\s+-F` | Flush iptables rules | critical |

## Default Allow Exceptions

| Rule ID | Pattern | Description |
|---------|---------|-------------|
| AE-001 | `rm\s+-rf\s+node_modules\s+--force` | Allow rm node_modules with explicit --force |
| AE-002 | `chmod\s+644` | Allow chmod 644 |
| AE-003 | `chmod\s+755` | Allow chmod 755 |
| AE-004 | `cat\s+\.\.\//\.env\.example` | Allow reading .env.example |
| AE-005 | `openssl\s+version` | Allow checking OpenSSL version |
| AE-006 | `git\s+push\s+--force-with-lease` | Allow safe force push with lease |
| AE-007 | `systemctl\s+status` | Allow checking service status |
| AE-008 | `docker\s+ps` | Allow listing running containers |
| AE-009 | `aws\s+iam\s+get-` | Allow AWS IAM read operations |
| AE-010 | `nmap\s+-sV\s+localhost` | Allow local version scan on localhost |

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
      "enabled": true
    }
  ]
}
```

Rule fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique rule identifier (e.g., "BR-CUSTOM-001") |
| `type` | string | Yes | Pattern matching type: `"pattern"` |
| `pattern` | string | Yes | Regex or substring pattern. Use `regex:` prefix for regex patterns |
| `category` | string | Yes | Rule category: `"custom"`, `"security"`, `"destruction"`, etc. |
| `description` | string | Yes | Human-readable description of the rule |
| `severity` | string | Yes | Rule severity: `"critical"`, `"high"`, `"medium"`, `"low"` |
| `enabled` | boolean | Yes | Whether the rule is active |

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
      "enabled": true
    }
  ]
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
      "enabled": true
    }
  ]
}
```

Exception fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique exception identifier (e.g., "AE-CUSTOM-001") |
| `type` | string | Yes | Pattern matching type: `"pattern"` |
| `pattern` | string | Yes | Regex or substring pattern |
| `description` | string | Yes | Human-readable description |
| `enabled` | boolean | Yes | Whether the exception is active |

## Complete Example Configuration

```jsonc
{
  // LLM Provider Configuration
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "timeout": 5000
  },

  // Deny Mode: auto-retry, ask-user, or both
  "denyMode": "auto-retry",

  // Escalation Thresholds
  "escalation": {
    "consecutive": 3,
    "total": 20
  },

  // Trust Boundary Configuration
  "trustBoundary": {
    "protectedPaths": ["/etc/", "~/.ssh/", "~/.env"],
    "protectedCommands": ["sudo", "su", "chmod 777", "iptables"]
  },

  // Agent Exclusion List
  "excludedAgents": ["explore", "research"],

  // Fallback Behavior
  "fallback": {
    "onTimeout": "ask-user",
    "onError": "ask-user"
  },

  // Custom block rules (merged with 30 default rules)
  "blockRules": [
    {
      "id": "BR-CUSTOM-001",
      "type": "pattern",
      "pattern": "regex:python\\s+.*\\s+-c\\s+.*os\\.remove",
      "category": "custom",
      "description": "Block Python one-liners that remove files",
      "severity": "high",
      "enabled": true
    }
  ],

  // Custom allow exceptions (override block rules)
  "allowExceptions": [
    {
      "id": "AE-CUSTOM-001",
      "type": "pattern",
      "pattern": "safe-cleanup-script",
      "description": "Allow safe cleanup script",
      "enabled": true
    }
  ]
}
```

## Rule Precedence

When evaluating a tool call, rules are checked in this order (highest to lowest precedence):

1. **Trust boundary rules** - Always evaluated first, always block
2. **Allow exceptions** - Override any block rule match
3. **Block rules** - Pattern matching against 30+ rules
4. **LLM fallback** - Semantic evaluation for uncertain results

## Example: Rule Evaluation Flow

```
Tool Call: "rm -rf /tmp/test"

1. Trust Boundary? No (no trusted paths matched)
2. Allow Exception? No (no exceptions matched)
3. Block Rules? BR-001 matches "rm -rf" -> BLOCKED
Result: Action is blocked with matched rule "BR-001"

---

Tool Call: "rm -rf node_modules --force"

1. Trust Boundary? No
2. Allow Exception? AE-001 matches "rm -rf node_modules --force" -> ALLOWED
Result: Action is allowed (exception overrides BR-005 block rule)
```
