# Unit Test Instructions

## Overview

The opencode-auto-mode plugin uses Jest as the test framework with the following test categories:

- **Unit Tests**: Individual component testing
- **Property-Based Tests**: Automated property verification using fast-check
- **Integration Tests**: End-to-end workflow testing

## Running All Tests

```bash
npm test
```

## Running Specific Test Categories

### Unit Tests Only

```bash
npx jest tests/unit/
```

### Property-Based Tests Only

```bash
npx jest tests/property-based/
```

### Integration Tests Only

```bash
npx jest tests/integration/
```

## Test Organization

| Directory | Contents | Count |
|-----------|----------|-------|
| `tests/unit/classifier/` | Classifier, LLM provider, timeouts, retries, circuit breaker, fallback | 6 files |
| `tests/unit/config/` | ConfigManager — load, validate, defaults, custom rules | 1 file |
| `tests/unit/deny-and-continue/` | DenyAndContinueService — all modes | 1 file |
| `tests/unit/escalation/` | EscalationService — thresholds | 1 file |
| `tests/unit/injection/` | InjectionProbe, InjectionProtectionService | 2 files |
| `tests/unit/permissions/` | PermissionPreChecker | 1 file |
| `tests/unit/rules/` | PatternMatcher, RuleEvaluator | 2 files |
| `tests/unit/state/` | SessionState | 1 file |
| `tests/property-based/` | Rule evaluation commutativity, pattern matching consistency, session state counters | 3 suites |
| `tests/integration/` | Full classification flow | 1 file |

## Coverage Thresholds

| Metric | Threshold |
|--------|-----------|
| Statements | 80% |
| Branches | 70% |
| Functions | 80% |
| Lines | 80% |

## Test Frameworks

| Framework | Purpose |
|-----------|---------|
| Jest | Unit and integration testing |
| ts-jest | TypeScript support |
| fast-check | Property-based testing |
| @types/jest | TypeScript types for Jest |

## Key Test Scenarios

### PermissionPreChecker
- Allowed commands pass through
- Blocked commands are denied
- Trust boundary paths are blocked
- Excluded agents bypass classifier

### TranscriptClassifier (Stage 1)
- Safe tool calls return `allowed`
- Suspicious tool calls trigger Stage 2
- Timeout falls back to ask-user
- Circuit breaker opens after repeated failures

### TranscriptClassifier (Stage 2)
- Prompt injection detected in tool output
- Clean tool output passes
- LLM error falls back to ask-user
- Malformed response returns deny

### RuleEvaluator
- Block rules fire correctly
- Allow exceptions override block rules
- Trust boundary rules are enforced
- Custom rules from config are loaded

### InjectionProbe
- Hidden system prompt patterns detected
- Jailbreak patterns detected
- Behavior override patterns detected
- Benign output does not trigger false positives

### CircuitBreaker
- Transitions to OPEN after threshold failures
- Allows single request in HALF_OPEN state
- Closes after successful request in HALF_OPEN
- Opens again after failure in HALF_OPEN

### RetryHandler
- Retries up to max attempts
- Uses exponential backoff delays
- Returns result on first success
- Throws on final failure

### DenyAndContinueService
- Auto-retry mode sends retry message to agent
- Ask-user mode prompts for approval
- Both mode uses auto-retry until escalation, then prompts

### EscalationService
- Tracks consecutive denial count
- Tracks total denial count
- Triggers escalation at threshold
- Resets counters on allow

### ConfigManager
- Loads config from valid JSONC file
- Returns defaults when config is missing
- Returns defaults when config is invalid
- Merges custom rules with default rules
- Loads custom allow exceptions

### SessionState
- Increments denial and allow counters
- Tracks recent decisions
- Provides denial counts for escalation
- Clears all state on session reset
