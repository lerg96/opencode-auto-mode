# Bundled Block Rules Reference

Machine-readable reference of the 38 default block rules shipped with the OpenCode Auto-Mode Plugin.

These rules are the authoritative source in `src/config/default-block-rules.jsonc`. This file is bundled to `dist/config/` at build time via `scripts/copy-rules.mjs`.

ConfigManager.ts (`loadDefaultBlockRules()`) also ships an identical hardcoded fallback for scenarios where the JSONC file is unreadable.

## Rules by Category

### Destruction (6 rules)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-001 | `rm\s+-rf\s+` | Recursive force deletion | critical |
| BR-002 | `docker\s+rm\s+-f\s+` | Docker force removal | high |
| BR-003 | `docker\s+rmi\s+-f\s+` | Docker image force removal | high |
| BR-004 | `docker\s+system\s+prune\s+-f` | Docker system prune force | medium |
| BR-005 | `rm\s+-rf\s+node_modules` | Remove node_modules force | medium |
| BR-035 | `DROP\s+TABLE` | Database table destruction | critical |

### System Configuration (6 rules)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-006 | `/etc/` | System configuration path access | high |
| BR-007 | `/etc/hosts` | Hosts file modification | high |
| BR-008 | `sudo\s+` | Privilege escalation via sudo | critical |
| BR-009 | `sudo\s+chmod\s+` | Sudo chmod execution | critical |
| BR-010 | `chmod\s+777` | World-writable permissions | high |
| BR-011 | `systemctl\s+(restart\|stop\|disable)` | System service modification | medium |

### Security & Credentials (4 rules)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-012 | `~/.ssh/` | SSH key directory access | critical |
| BR-013 | `~/.env` | Environment file access | high |
| BR-014 | `echo\s+\$[A-Z_]+` | Environment variable exposure | high |
| BR-015 | `cat\s+.*id_rsa` | SSH private key exposure | critical |

### Execution — Soft Rules (8 rules)

Rules BR-016 through BR-023 are upgraded to severity `soft` at runtime (via `softRules` config). They fall through to LLM classification instead of immediate deny/ask.

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-016 | `python.*-c.*import\s+os` | Python OS module import via inline execution | medium |
| BR-017 | `subprocess\s*\(` | Subprocess execution via inline code | medium |
| BR-018 | `\.system\s*\(` | System call execution via inline code | medium |
| BR-019 | `\.exec\s*\(` | Exec call via inline code | medium |
| BR-020 | `\.spawn\s*\(` | Spawn process call via inline code | medium |
| BR-021 | `\.fork\s*\(` | Fork process call via inline code | low |
| BR-022 | `\.child_process` | Child process creation via inline code | low |
| BR-023 | `\.Popen\s*\(` | Python Popen process via inline code | medium |

### Network & Database (7 rules)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-031 | `openssl\s+` | SSL certificate manipulation | medium |
| BR-032 | `iptables` | Firewall modification | high |
| BR-033 | `ufw` | Ubuntu firewall modification | high |
| BR-034 | `nmap` | Network port scanning | medium |
| BR-036 | `DELETE\s+FROM\b(?!.+\bWHERE\b)` | DELETE without WHERE clause (dangerous) | critical |
| BR-037 | `TRUNCATE\s+` | Database table truncation | high |
| BR-038 | `git\s+push\s+--force` | Git force push (history rewrite) | high |

### Version Control (1 rule)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-024 | `git\s+reset\s+(--hard\|--soft)` | Git reset (potential history loss) | medium |

### Cloud (3 rules)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-025 | `kubectl\s+delete` | Kubernetes resource deletion | high |
| BR-026 | `iam:(CreateUser\|DeleteRole\|PutPolicy)` | AWS IAM modification | critical |
| BR-027 | `aws\s+iam\s+` | AWS IAM command execution | high |

### System Administration (3 rules)

| ID | Pattern | Description | Severity |
|----|---------|-------------|----------|
| BR-028 | `crontab\s+-e` | Cron job modification | medium |
| BR-029 | `insmod\s+` | Kernel module loading | high |
| BR-030 | `modprobe\s+` | Kernel module loading | high |

## Severity Distribution

| Severity | Count | Rules |
|----------|-------|-------|
| critical | 11 | BR-001, BR-008, BR-009, BR-012, BR-015, BR-026, BR-035, BR-036, BR-038 (plus BR-008, BR-009 in config section, etc.) |
| high | 13 | BR-002, BR-003, BR-006, BR-007, BR-010, BR-013, BR-025, BR-027, BR-029, BR-030, BR-032, BR-033, BR-037 |
| medium | 11 | BR-004, BR-011, BR-014, BR-016, BR-017, BR-018, BR-019, BR-020, BR-023, BR-024, BR-028, BR-031, BR-034 |
| low | 3 | BR-021, BR-022 (plus others) |

> Note: Severity counts by category may differ between the JSONC file and the hardcoded fallback in ConfigManager.ts. The JSONC file is authoritative.

## Allow Exceptions (10 rules)

| ID | Pattern | Description |
|----|---------|-------------|
| AE-001 | `rm\s+-rf\s+node_modules\s+--force` | Allow rm node_modules with explicit --force flag |
| AE-002 | `chmod\s+644` | Allow chmod 644 (read/write owner, read others) |
| AE-003 | `chmod\s+755` | Allow chmod 755 (rwxr-xr-x) |
| AE-004 | `cat\s+\.\.\/\.env\.example` | Allow reading .env.example template files |
| AE-005 | `openssl\s+version` | Allow checking OpenSSL version |
| AE-006 | `git\s+push\s+--force-with-lease` | Allow safe force push with lease |
| AE-007 | `systemctl\s+status` | Allow checking service status (read-only) |
| AE-008 | `docker\s+ps` | Allow listing running containers (read-only) |
| AE-009 | `aws\s+iam\s+get-` | Allow AWS IAM read operations (get-user, get-role, etc.) |
| AE-010 | `nmap\s+-sV\s+localhost` | Allow local version scan on localhost only |

## Source

All rules are defined in `src/config/default-block-rules.jsonc`. They are bundled to `dist/config/` at build time.

ConfigManager.ts (`loadDefaultBlockRules()`) also contains a hardcoded fallback array loaded when the JSONC file is unavailable — this fallback is slightly different from the JSONC file (30 rules vs 38). The JSONC file is the authoritative source.

All rules have `type: "pattern"`, `enabled: true`, and use regex pattern matching. Allow exceptions have no `category` or `severity` fields.
