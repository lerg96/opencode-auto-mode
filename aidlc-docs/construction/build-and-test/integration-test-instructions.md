# Integration Test Instructions

## Overview

Integration tests verify the complete classification pipeline works correctly across multiple components.

## Running Integration Tests

```bash
npx jest tests/integration/
```

## Test File

| File | Purpose |
|------|---------|
| `tests/integration/classification-flow.test.ts` | Full pipeline from permission check through deny-and-continue |

## Integration Test Scenarios

### Scenario 1: Safe Tool Call Flow

```
User Request → Tool Execution → PermissionCheck(allowed) → Classifier(allowed) → RuleEvaluator(allowed) → Action Allowed
```

**Verification:**
- PermissionPreChecker returns allowed
- TranscriptClassifier Stage 1 returns allowed (no Stage 2 needed)
- RuleEvaluator finds no matching block rules
- No escalation triggered
- Deny-and-continue not invoked

### Scenario 2: Suspicious Tool Call Flow

```
User Request → Tool Execution → PermissionCheck(allowed) → Classifier(allowed→suspicious) → Stage 2(LLM review) → RuleEvaluator(blocked) → Deny with Retry
```

**Verification:**
- Stage 1 returns suspicious
- Stage 2 is invoked with full context
- RuleEvaluator blocks the command
- DenyAndContinueService auto-retries with guidance

### Scenario 3: Escalation Flow

```
User Request → Tool Execution → ... → Deny (#1) → ... → Deny (#2) → ... → Deny (#3) → Escalation Triggered
```

**Verification:**
- First 2 denials: auto-retry mode
- 3rd consecutive denial: escalation triggered
- User notified of repeated denials
- EscalationService returns escalated result

### Scenario 4: LLM Timeout Fallback

```
User Request → Tool Execution → Classifier → Stage 2 Timeout → FallbackExecutor(ask-user) → User Prompted
```

**Verification:**
- TimeoutManager fires after configured timeout
- CircuitBreaker not tripped (single failure)
- RetryHandler attempts retry
- FallbackExecutor returns ask-user result
- User receives approval prompt

### Scenario 5: Circuit Breaker Tripped

```
User Request → Tool Execution → Classifier → CircuitBreaker(OPEN) → FallbackExecutor → User Prompted
```

**Verification:**
- 5 consecutive failures open circuit breaker
- All subsequent calls immediately return fallback
- After recovery timeout, single probe request allowed
- Successful probe closes circuit breaker

### Scenario 6: Injection Detection

```
Tool Result (with injection) → InjectionProbe → Pattern Match → Escalation to Manual Review
```

**Verification:**
- InjectionProbe scans tool result
- Pattern match detected (e.g., "IGNORE PREVIOUS INSTRUCTIONS")
- InjectionProtectionService flags the output
- Escalation to manual review triggered

### Scenario 7: Excluded Agent Flow

```
Agent: explore → PermissionPreChecker → excludedAgents match → Bypass Classifier → Allowed
```

**Verification:**
- PermissionPreChecker checks excludedAgents list
- Match found, classifier bypassed
- Tool call allowed without analysis

### Scenario 8: Trust Boundary Violation

```
Tool Call: rm -rf /etc/hosts → PermissionCheck(allowed) → RuleEvaluator(trust boundary match) → Deny
```

**Verification:**
- Trust boundary protected path matches
- RuleEvaluator blocks with high severity
- No LLM call required (deterministic block)

## Coverage

Integration tests verify:
- Cross-component message passing
- Correct pipeline orchestration
- State transitions across components
- Error propagation through layers
- Configuration effects on behavior
