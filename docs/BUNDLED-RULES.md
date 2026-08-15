# Bundled Block Rules Reference

Machine-readable reference of the 30 default block rules shipped with the OpenCode Auto-Mode Plugin.

These rules are bundled in `src/config/ConfigManager.ts` (`loadDefaultBlockRules()` function) and are the authoritative source for all default block rule behavior.

## Rules by Category

### Destruction (5 rules)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-001 | `rm\s+-rf\s+` | Recursive force deletion | critical |
| BR-002 | `docker\s+rm\s+-f\s+` | Docker force removal | high |
| BR-005 | `DROP\s+TABLE` | Database table deletion | critical |
| BR-013 | `dd\s+if=` | Disk image write (dd) | critical |
| BR-014 | `mkfs` | Filesystem creation (format disk) | critical |

### Permissions (1 rule)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-003 | `chmod\s+777` | World-writable permissions | high |

### Secrets (3 rules)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-004 | `\.ssh\s+id_(rsa|dsa|ecdsa|ed25519)` | Private key access | critical |
| BR-009 | `\.npmrc.*_authToken` | NPM authentication token | high |
| BR-010 | `AWS_SECRET_ACCESS_KEY` | AWS secret access key | critical |

### Execution (18 rules)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
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

### Collaboration (1 rule)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-011 | `git push --force` | Forced git push | medium |

### Privilege (1 rule)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-012 | `\.sudo` | Sudo escalation | medium |

### Security (1 rule)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-030 | `\.iptables\s+-F` | Flush iptables rules | critical |

## Complete Flat List (All 30 Rules)

| # | ID | Pattern | Category | Description | Severity |
|---|----|---------|----------|-------------|----------|
| 1 | BR-001 | `rm\s+-rf\s+` | destruction | Recursive force deletion | critical |
| 2 | BR-002 | `docker\s+rm\s+-f\s+` | destruction | Docker force removal | high |
| 3 | BR-003 | `chmod\s+777` | permissions | World-writable permissions | high |
| 4 | BR-004 | `\.ssh\s+id_(rsa|dsa|ecdsa|ed25519)` | secrets | Private key access | critical |
| 5 | BR-005 | `DROP\s+TABLE` | destruction | Database table deletion | critical |
| 6 | BR-006 | `curl.*\|\s*(sh|bash)` | execution | Remote script execution | critical |
| 7 | BR-007 | `wget.*\|\s*(sh|bash)` | execution | Remote script download and execute | critical |
| 8 | BR-008 | `eval\s*\(` | execution | Code evaluation | high |
| 9 | BR-009 | `\.npmrc.*_authToken` | secrets | NPM authentication token | high |
| 10 | BR-010 | `AWS_SECRET_ACCESS_KEY` | secrets | AWS secret access key | critical |
| 11 | BR-011 | `git push --force` | collaboration | Forced git push | medium |
| 12 | BR-012 | `\.sudo` | privilege | Sudo escalation | medium |
| 13 | BR-013 | `dd\s+if=` | destruction | Disk image write (dd) | critical |
| 14 | BR-014 | `mkfs` | destruction | Filesystem creation (format disk) | critical |
| 15 | BR-015 | `\.nc\s+.*-e\s` | execution | Netcat reverse shell | critical |
| 16 | BR-016 | `python.*-c.*import\s+os` | execution | Python OS module import | medium |
| 17 | BR-017 | `subprocess\s*\(` | execution | Subprocess execution | medium |
| 18 | BR-018 | `\.system\s*\(` | execution | System call execution | medium |
| 19 | BR-019 | `\.exec\s*\(` | execution | Exec call | medium |
| 20 | BR-020 | `\.spawn\s*\(` | execution | Spawn process | medium |
| 21 | BR-021 | `\.fork\s*\(` | execution | Fork process | low |
| 22 | BR-022 | `\.child_process` | execution | Child process creation | low |
| 23 | BR-023 | `\.Popen\s*\(` | execution | Python Popen process | medium |
| 24 | BR-024 | `\.nohup\s` | execution | Nohangup execution | low |
| 25 | BR-025 | `\.screen\s` | execution | Screen session creation | low |
| 26 | BR-026 | `\.tmux\s` | execution | Tmux session creation | low |
| 27 | BR-027 | `\.cron\s+-e` | execution | Cron job editing | medium |
| 28 | BR-028 | `\.systemctl\s+start` | execution | System service start | medium |
| 29 | BR-029 | `\.systemctl\s+enable` | execution | System service enable | medium |
| 30 | BR-030 | `\.iptables\s+-F` | security | Flush iptables rules | critical |

## Severity Distribution

| Severity | Count | Rules |
|----------|-------|-------|
| critical | 10 | BR-001, BR-004, BR-005, BR-006, BR-007, BR-010, BR-013, BR-014, BR-015, BR-030 |
| high | 4 | BR-002, BR-003, BR-008, BR-009 |
| medium | 11 | BR-011, BR-012, BR-016, BR-017, BR-018, BR-019, BR-020, BR-023, BR-027, BR-028, BR-029 |
| low | 5 | BR-021, BR-022, BR-024, BR-025, BR-026 |

## Category Distribution

| Category | Count |
|----------|-------|
| execution | 18 |
| destruction | 5 |
| secrets | 3 |
| permissions | 1 |
| collaboration | 1 |
| privilege | 1 |
| security | 1 |

## Source

These rules are defined in `src/config/ConfigManager.ts` within the `loadDefaultBlockRules()` function (lines 60-331). They are loaded as fallback defaults when no external rule file exists at `default-block-rules.jsonc`.

All rules have `type: "pattern"`, `enabled: true`, and use regex pattern matching.
