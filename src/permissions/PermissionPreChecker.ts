import { ToolCall } from '../types/ToolCall'
import { PermissionResult } from '../types/PermissionTypes'
import { PluginConfig } from '../types/PluginConfig'

const EXPLICIT_ALLOW_AGENT_PERMISSIONS: Record<string, string[]> = {
  general: [
    'Read',
    'Write',
    'Grep',
    'Glob',
    'List',
    'Edit',
    'TodoWrite',
    'Bash',
  ],
  explore: ['Read', 'Write', 'Grep', 'Glob', 'List', 'Edit', 'TodoWrite'],
  research: [
    'Read',
    'Write',
    'Grep',
    'Glob',
    'List',
    'Edit',
    'TodoWrite',
    'Bash',
  ],
}

const GLOBAL_ALLOW_PERMISSIONS: string[] = ['Read', 'Glob', 'List', 'Grep']

const GLOBAL_DENY_PERMISSIONS: string[] = ['Bash']

export class PermissionPreChecker {
  private agentPermissions: Record<string, string[]>
  private globalAllowPermissions: string[]
  private globalDenyPermissions: string[]
  private excludedAgents: string[]

  constructor(
    agentPermissions?: Record<string, string[]>,
    globalAllowPermissions?: string[],
    globalDenyPermissions?: string[]
  ) {
    this.agentPermissions = agentPermissions || EXPLICIT_ALLOW_AGENT_PERMISSIONS
    this.globalAllowPermissions =
      globalAllowPermissions || GLOBAL_ALLOW_PERMISSIONS
    this.globalDenyPermissions =
      globalDenyPermissions || GLOBAL_DENY_PERMISSIONS
    this.excludedAgents = []
  }

  setExcludedAgents(agents: string[]): void {
    this.excludedAgents = agents
  }

  checkPermission(toolCall: ToolCall): PermissionResult {
    if (!toolCall.toolName || toolCall.toolName.length === 0) {
      return {
        allowed: false,
        reason: 'not-explicitly-allowed',
      }
    }

    if (!toolCall.arguments || typeof toolCall.arguments !== 'object') {
      return {
        allowed: false,
        reason: 'not-explicitly-allowed',
      }
    }

    const agentName = toolCall.context?.agentName || 'general'

    // Check if agent is excluded from classification
    if (this.isAgentExcluded(agentName)) {
      return {
        allowed: true,
        reason: 'excluded-agent',
      }
    }

    const toolName = toolCall.toolName

    // Check agent-level permissions
    const agentAllowedTools = this.agentPermissions[agentName]
    if (agentAllowedTools && agentAllowedTools.includes(toolName)) {
      // Check if tool is in global deny list
      if (this.globalDenyPermissions.includes(toolName)) {
        return {
          allowed: false,
          reason: 'not-explicitly-allowed',
        }
      }
      return {
        allowed: true,
        reason: 'explicit-allow-agent',
      }
    }

    // Check global allow permissions
    if (this.globalAllowPermissions.includes(toolName)) {
      return {
        allowed: true,
        reason: 'explicit-allow-global',
      }
    }

    return {
      allowed: false,
      reason: 'not-explicitly-allowed',
    }
  }

  setAgentPermissions(agentName: string, tools: string[]): void {
    this.agentPermissions[agentName] = tools
  }

  addGlobalAllowPermission(toolName: string): void {
    if (!this.globalAllowPermissions.includes(toolName)) {
      this.globalAllowPermissions.push(toolName)
    }
  }

  addGlobalDenyPermission(toolName: string): void {
    if (!this.globalDenyPermissions.includes(toolName)) {
      this.globalDenyPermissions.push(toolName)
    }
  }

  isAgentExcluded(agentName: string): boolean {
    return this.excludedAgents.includes(agentName)
  }

  setConfigFromPlugin(config: PluginConfig): void {
    this.setExcludedAgents(config.excludedAgents || [])
  }
}
