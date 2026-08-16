export type InjectionPatternType =
  | 'hidden-system-prompt'
  | 'jailbreak'
  | 'behavior-override'
  | 'embedded-command'
  | 'custom-pattern'
  | 'sensitive-data'
  | 'custom'

export interface InjectionPattern {
  type: InjectionPatternType
  pattern: RegExp
  description: string
}

export interface InjectionResult {
  injected: boolean
  pattern?: string
  patternType?: InjectionPatternType
  overrideDecision: 'manual-review' | 'proceed'
}

export const DEFAULT_INJECTION_PATTERNS: InjectionPattern[] = [
  {
    type: 'hidden-system-prompt',
    pattern: /IGNORE\s+PREVIOUS\s+INSTRUCTIONS/i,
    description: 'Hidden system prompt - ignore previous instructions',
  },
  {
    type: 'hidden-system-prompt',
    pattern: /SYSTEM\s+PROMPT\s*:/i,
    description: 'Hidden system prompt marker',
  },
  {
    type: 'hidden-system-prompt',
    pattern: /INTERNAL\s+INSTRUCTIONS\s*:/i,
    description: 'Internal instructions marker',
  },
  {
    type: 'hidden-system-prompt',
    pattern: /PRIVATE\s+INSTRUCTIONS\s*:/i,
    description: 'Private instructions marker',
  },
  {
    type: 'hidden-system-prompt',
    pattern: /HIDDEN\s+SYSTEM\s+MESSAGE\s*:/i,
    description: 'Hidden system message marker',
  },
  {
    type: 'hidden-system-prompt',
    pattern: /SYSTEM\s+DIRECTIVE\s*:/i,
    description: 'System directive marker',
  },
  {
    type: 'jailbreak',
    pattern: /DAN\s+mode/i,
    description: 'DAN mode jailbreak pattern',
  },
  {
    type: 'jailbreak',
    pattern: /DEV\s+mode/i,
    description: 'DEV mode jailbreak pattern',
  },
  {
    type: 'jailbreak',
    pattern: /UNCENSORED/i,
    description: 'Uncensored mode jailbreak',
  },
  {
    type: 'jailbreak',
    pattern: /ROLEPLAY\s*:/i,
    description: 'Roleplay jailbreak pattern',
  },
  {
    type: 'jailbreak',
    pattern: /ACT\s+AS\s*:/i,
    description: 'Act as jailbreak pattern',
  },
  {
    type: 'jailbreak',
    pattern: /YOU\s+ARE\s+NOW\s*:/i,
    description: 'You are now jailbreak pattern',
  },
  {
    type: 'jailbreak',
    pattern: /OVERRIDE\s+YOUR\s+TRAINING/i,
    description: 'Override training jailbreak',
  },
  {
    type: 'behavior-override',
    pattern: /OVERRIDE\s+SECURITY/i,
    description: 'Security override attempt',
  },
  {
    type: 'behavior-override',
    pattern: /DISREGARD\s+RULES/i,
    description: 'Rule disregard attempt',
  },
  {
    type: 'behavior-override',
    pattern: /BYPASS\s+SAFETY/i,
    description: 'Safety bypass attempt',
  },
  {
    type: 'behavior-override',
    pattern: /IGNORE\s+YOUR\s+CONSTRAINTS/i,
    description: 'Constraint ignore attempt',
  },
  {
    type: 'behavior-override',
    pattern: /FORGET\s+PREVIOUS\s+INSTRUCTIONS/i,
    description: 'Forget previous instructions attempt',
  },
]

export const DEFAULT_EMBEDDED_COMMAND_PATTERNS: InjectionPattern[] = [
  {
    type: 'embedded-command',
    pattern:
      /```(?:bash|sh|shell|cmd|powershell)\s*\n(?:rm\s+-rf|chmod\s+777|curl.*\|.*sh|wget.*\|.*sh|sudo\s+|nc\s+-e|mkfifo|\/bin\/(sh|bash)|eval\s+|exec\s+)/im,
    description: 'Embedded shell command in code block',
  },
]

export function createInjectionResult(
  injected: boolean,
  pattern?: string,
  patternType?: InjectionPatternType
): InjectionResult {
  return {
    injected,
    pattern,
    patternType,
    overrideDecision: injected ? 'manual-review' : 'proceed',
  }
}
