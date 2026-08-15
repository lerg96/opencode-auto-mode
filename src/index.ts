import { ConfigManager } from './config/ConfigManager';
import { SessionState } from './state/SessionState';
import { PermissionPreChecker } from './permissions/PermissionPreChecker';
import { RuleEvaluator } from './rules/RuleEvaluator';
import { LLMProviderAbstraction } from './classifier/LLMProviderAbstraction';
import { TranscriptClassifier } from './classifier/TranscriptClassifier';
import { ClassificationService } from './classifier/ClassificationService';
import { DenyAndContinueService } from './deny-and-continue/DenyAndContinueService';
import { EscalationService } from './escalation/EscalationService';
import { InjectionProtectionService } from './injection/InjectionProtectionService';

export interface OpenCodePluginAPI {
  registerHook(hookName: string, handler: (...args: unknown[]) => unknown): void;
  getConfig<T>(key: string): T | undefined;
  getProviderConfig(provider: string): { apiKey?: string; baseUrl?: string } | undefined;
}

export interface OpenCodePlugin {
  name: string;
  version: string;
  initialize(api: OpenCodePluginAPI): void;
}

export class AutoModePlugin {
  private configManager!: ConfigManager;
  private sessionState!: SessionState;
  private permissionPreChecker!: PermissionPreChecker;
  private ruleEvaluator!: RuleEvaluator;
  private llmProvider: LLMProviderAbstraction | null = null;
  private transcriptClassifier!: TranscriptClassifier;
  private classificationService!: ClassificationService;
  private denyAndContinueService!: DenyAndContinueService;
  private escalationService!: EscalationService;
  private injectionProtectionService!: InjectionProtectionService;
  private api!: OpenCodePluginAPI;
  private initialized = false;
  private pendingUserHooks: Array<{ hookName: string; handler: (...args: unknown[]) => unknown }> = [];

  public initialize(api: OpenCodePluginAPI): void {
    if (this.initialized) {
      return;
    }

    const pluginConfig = api.getConfig<Record<string, unknown>>('auto-mode') || {};
    const configPath = pluginConfig.configPath as string | undefined;

    this.configManager = new ConfigManager(configPath);
    const config = this.configManager.getConfig();

    this.sessionState = new SessionState();
    this.permissionPreChecker = new PermissionPreChecker();
    this.permissionPreChecker.setConfigFromPlugin(config);
    this.ruleEvaluator = new RuleEvaluator();

    const providerConfig = api.getProviderConfig(config.llm.provider);
    const apiKey = providerConfig?.apiKey || '';

    this.llmProvider = new LLMProviderAbstraction(config, apiKey);
    this.transcriptClassifier = new TranscriptClassifier(
      this.llmProvider,
      this.ruleEvaluator,
      this.sessionState,
      config
    );
    this.escalationService = new EscalationService(this.sessionState, config);
    this.injectionProtectionService = new InjectionProtectionService({
      enabled: true,
      scanToolResults: true,
      scanUserMessages: true,
    });
    this.classificationService = new ClassificationService(
      this.permissionPreChecker,
      this.transcriptClassifier,
      this.sessionState,
      this.escalationService,
      this.ruleEvaluator,
      config,
      this.injectionProtectionService
    );
    this.denyAndContinueService = new DenyAndContinueService(config, this.sessionState);

    // Register tool.execute.before hook
    api.registerHook('tool.execute.before', async (toolCall: unknown) => {
      return this.handleToolExecution(toolCall);
    });

    // Register session context hook for injection protection
    api.registerHook('session.context', async (context: unknown) => {
      return this.handleSessionContext(context);
    });

    // Register session end hook
    api.registerHook('session.end', () => {
      this.sessionState.clear();
      if (this.classificationService) {
        this.classificationService.clearSessionHistory();
      }
    });

    // Register any user-provided hooks that were registered before initialize completed
    for (const { hookName, handler } of this.pendingUserHooks) {
      this.registerHookWithRetry(api, hookName, handler);
    }
    this.pendingUserHooks.length = 0;

    this.api = api;
    this.initialized = true;
  }

  private async handleToolExecution(toolCall: unknown): Promise<unknown> {
    if (!toolCall || typeof toolCall !== 'object') {
      return null;
    }

    const call = toolCall as {
      toolName: string;
      arguments: Record<string, unknown>;
      context?: { agentName?: string; sessionId?: string };
    };

    const sanitizedToolCall = {
      toolName: call.toolName,
      arguments: call.arguments || {},
      context: {
        agentName: call.context?.agentName || 'general',
        workingDirectory: process.cwd(),
        sessionId: call.context?.sessionId || '',
      },
    };

    try {
      const result = await this.classificationService.classify(sanitizedToolCall);

      if (result.decision === 'allow') {
        return null;
      }

      if (result.decision === 'deny') {
        const denyResult = await this.denyAndContinueService.handleDeny(result);
        return {
          __autoMode: true,
          action: 'blocked',
          message: denyResult.message,
          rule: result.blockRule,
        };
      }

      if (result.decision === 'escalate') {
        return {
          __autoMode: true,
          action: 'escalated',
          message: result.reasoning,
          rule: result.blockRule,
        };
      }

      return null;
    } catch (error) {
      const safeError = error instanceof Error ? error.message : String(error);
      console.error(`[Auto-Mode] Error during classification, blocking action: ${safeError}`);
      return {
        __autoMode: true,
        action: 'blocked' as const,
        message: 'Auto-mode error: action blocked due to classification failure',
      };
    }
  }

  private async handleSessionContext(context: unknown): Promise<unknown> {
    if (!context || typeof context !== 'object') {
      return context;
    }

    const ctx = context as {
      sessionId?: string;
      toolResult?: string;
      message?: string;
    };

    let modified = false;
    const result = { ...ctx };

    try {
      if (ctx.toolResult) {
        const scanResult = await this.injectionProtectionService.scanToolResult(
          ctx.toolResult,
          ctx.sessionId
        );
        if (scanResult.injectionDetected) {
          console.warn(`[Auto-Mode] Injection detected in tool result: ${scanResult.message}`);
          result.toolResult = '[Auto-Mode] Action blocked: potential prompt injection detected in tool output. Please review the tool result manually.';
          modified = true;
        }
      }

      if (ctx.message) {
        const scanResult = await this.injectionProtectionService.scanMessage(ctx.message);
        if (scanResult.injectionDetected) {
          console.warn(`[Auto-Mode] Injection detected in message: ${scanResult.message}`);
          result.message = '[Auto-Mode] Action blocked: potential prompt injection detected. Please rephrase your request.';
          modified = true;
        }
      }
    } catch (error) {
      const safeError = error instanceof Error ? error.message : String(error);
      console.error(`[Auto-Mode] Error during injection scan: ${safeError}`);
    }

    return modified ? result : context;
  }

  public getSessionState(): SessionState | null {
    return this.initialized ? this.sessionState : null;
  }

  public getClassificationService(): ClassificationService | null {
    return this.initialized ? this.classificationService : null;
  }

  /**
   * Register a custom hook handler to be invoked at a specific hook point.
   *
   * This method allows consumers and other plugins to register additional handlers
   * alongside the built-in Auto-Mode hooks. The handler will be invoked with the
   * same arguments passed to the hook by the OpenCode runtime.
   *
   * Can be called at any time — if invoked before `initialize()` completes, the
   * handler is queued and registered automatically once the API is available.
   *
   * @param hookName - The name of the hook point to register for (e.g. 'tool.execute.before').
   * @param handler - The function to invoke when the hook fires. Receives the hook data
   *   as arguments. Must not throw; errors are caught and logged.
   *
   * @example
   * ```ts
   * const plugin = new AutoModePlugin();
   * plugin.registerUserHook('tool.execute.before', (toolCall) => {
   *   console.log('Custom handler:', toolCall);
   * });
   * ```
   */
  public registerUserHook(hookName: string, handler: (...args: unknown[]) => unknown): void {
    const wrappedHandler = this.wrapUserHandler(handler);

    if (this.initialized && this.api) {
      this.registerHookWithRetry(this.api, hookName, wrappedHandler);
    } else {
      this.pendingUserHooks.push({ hookName, handler: wrappedHandler });
    }
  }

  /**
   * Wrap a user-provided handler to prevent it from crashing the plugin.
   */
  private wrapUserHandler(handler: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
    return (...args: unknown[]) => {
      try {
        const result = handler(...args);
        // If the handler returns a Promise, also catch errors from it
        if (result instanceof Promise) {
          return result.catch((error) => {
            console.error(`[Auto-Mode] Error in user hook handler: ${error}`);
            return undefined;
          });
        }
        return result;
      } catch (error) {
        console.error(`[Auto-Mode] Error in user hook handler: ${error}`);
        return undefined;
      }
    };
  }

  /**
   * Register a hook via the API, with no fallback on failure.
   * RegisterHook itself should not throw, but we log for diagnostics.
   */
  private registerHookWithRetry(
    api: OpenCodePluginAPI,
    hookName: string,
    handler: (...args: unknown[]) => unknown
  ): void {
    try {
      api.registerHook(hookName, handler);
    } catch (error) {
      console.error(`[Auto-Mode] Failed to register user hook '${hookName}': ${error}`);
    }
  }
}

export function createPlugin(): OpenCodePlugin {
  const plugin = new AutoModePlugin();

  return {
    name: 'opencode-auto-mode',
    version: '1.0.0',
    initialize: (api: OpenCodePluginAPI) => plugin.initialize(api),
  };
}

export default createPlugin;
