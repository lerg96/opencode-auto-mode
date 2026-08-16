export interface ToolCallContext {
  agentName: string
  workingDirectory: string
  sessionId: string
}

export interface ToolCall {
  toolName: string
  arguments: Record<string, unknown>
  context: ToolCallContext
}

export function extractCommand(toolCall: ToolCall): string | null {
  if (toolCall.toolName !== 'Bash') {
    return null
  }
  const cmd = toolCall.arguments.command
  if (typeof cmd === 'string' && cmd.length > 0) {
    return cmd
  }
  return null
}

export function extractFilePath(toolCall: ToolCall): string | null {
  if (toolCall.toolName === 'Read' || toolCall.toolName === 'Write') {
    const path = toolCall.arguments.path
    if (typeof path === 'string' && path.length > 0) {
      return path
    }
  }
  return null
}

export function matchesPattern(toolCall: ToolCall, pattern: string): boolean {
  const cmd = extractCommand(toolCall)
  if (cmd) {
    const regex = new RegExp(pattern, 'i')
    if (regex.test(cmd)) {
      return true
    }
  }
  const filePath = extractFilePath(toolCall)
  if (filePath) {
    const regex = new RegExp(pattern, 'i')
    if (regex.test(filePath)) {
      return true
    }
  }
  const argsStr = JSON.stringify(toolCall.arguments)
  const regex = new RegExp(pattern, 'i')
  return regex.test(argsStr)
}
