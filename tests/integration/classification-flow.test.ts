import { ClassificationService } from '../../src/classifier/ClassificationService';
import { ToolCall } from '../../src/types/ToolCall';
import { PermissionPreChecker } from '../../src/permissions/PermissionPreChecker';
import { TranscriptClassifier } from '../../src/classifier/TranscriptClassifier';
import { SessionState } from '../../src/state/SessionState';
import { EscalationService } from '../../src/escalation/EscalationService';
import { RuleEvaluator } from '../../src/rules/RuleEvaluator';
import { DEFAULT_CONFIG } from '../../src/types/PluginConfig';
import { ClassificationResult } from '../../src/types/ClassificationResult';

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolName: 'Bash',
    arguments: { command: 'ls -la' },
    context: { agentName: 'general', workingDirectory: '/tmp', sessionId: 'test' },
    ...overrides,
  };
}

describe('Full Classification Flow - Integration Tests', () => {
  describe('end-to-end classification with mocked dependencies', () => {
    let mockTranscriptClassifier: jest.Mocked<TranscriptClassifier>;
    let mockEscalationService: jest.Mocked<EscalationService>;
    let service: ClassificationService;
    let sessionState: SessionState;

    beforeEach(() => {
      const mockPermissionChecker = new PermissionPreChecker();
      mockTranscriptClassifier = {
        classify: jest.fn().mockResolvedValue({
          decision: 'deny' as const,
          reasoning: 'Mock deny',
          stage: 2,
          timestamp: new Date(),
        }),
        prepareContext: jest.fn().mockImplementation((_h, tc) => ({
          userMessages: [],
          currentToolCall: tc,
          metadata: { sessionDuration: 0, messageCount: 0, toolExecutionCount: 0 },
        })),
        getLLMProvider: jest.fn(),
        getRuleEvaluator: jest.fn(),
      } as unknown as jest.Mocked<TranscriptClassifier>;

      mockEscalationService = {
        checkThresholds: jest.fn().mockReturnValue({ escalated: false }),
        triggerEscalation: jest.fn(),
        processApproval: jest.fn(),
        processDenial: jest.fn(),
        getThresholds: jest.fn().mockReturnValue({ consecutive: 3, total: 20 }),
        setThresholds: jest.fn(),
      } as unknown as jest.Mocked<EscalationService>;

      const mockRuleEvaluator = {
        evaluate: jest.fn().mockReturnValue({
          evaluation: 'allowed',
          rule: undefined,
        }),
      } as unknown as RuleEvaluator;

      sessionState = new SessionState();
      service = new ClassificationService(
        mockPermissionChecker,
        mockTranscriptClassifier,
        sessionState,
        mockEscalationService,
        mockRuleEvaluator,
        { ...DEFAULT_CONFIG, denyMode: 'auto-retry' } as any
      );
    });

    it('should complete full flow: permission check -> classifier -> escalation check', async () => {
      mockTranscriptClassifier.classify.mockResolvedValue({
        decision: 'deny' as const,
        reasoning: 'Action blocked',
        blockRule: 'BR-001',
        stage: 2,
        timestamp: new Date(),
      });

      const toolCall = createToolCall({ toolName: 'Bash' });
      const result = await service.classify(toolCall);

      expect(result.decision).toBe('deny');
      expect(mockTranscriptClassifier.prepareContext).toHaveBeenCalled();
      expect(mockTranscriptClassifier.classify).toHaveBeenCalled();
      expect(mockEscalationService.checkThresholds).toHaveBeenCalled();
    });

    it('should handle allow path through permission pre-checker', async () => {
      const toolCall = createToolCall({ toolName: 'Read' });
      const result = await service.classify(toolCall);

      expect(result.decision).toBe('allow');
      expect(result.stage).toBe(1);
    });

    it('should handle excluded agent path', async () => {
      const toolCall = createToolCall({ context: { ...createToolCall().context, agentName: 'explore' } });
      const result = await service.classify(toolCall);

      expect(result.decision).toBe('allow');
      expect(['rule-eval', 1]).toContain(result.stage);
    });
  });

  describe('session state integration', () => {
    it('should correctly track denial counters through service interactions', async () => {
      const sessionState = new SessionState();
      const ruleEvaluator = new RuleEvaluator();
      const permissionChecker = new PermissionPreChecker();

      const mockTranscriptClassifier = {
        classify: jest.fn().mockResolvedValue({
          decision: 'deny' as const,
          reasoning: 'Denied',
          stage: 2,
          timestamp: new Date(),
        }),
        prepareContext: jest.fn().mockImplementation((_h, tc) => ({
          userMessages: [],
          currentToolCall: tc,
          metadata: { sessionDuration: 0, messageCount: 0, toolExecutionCount: 0 },
        })),
        getLLMProvider: jest.fn(),
        getRuleEvaluator: jest.fn(),
      } as unknown as jest.Mocked<TranscriptClassifier>;

      const mockEscalationService = {
        checkThresholds: jest.fn().mockReturnValue({ escalated: false }),
        triggerEscalation: jest.fn(),
        processApproval: jest.fn(),
        processDenial: jest.fn(),
        getThresholds: jest.fn().mockReturnValue({ consecutive: 3, total: 20 }),
        setThresholds: jest.fn(),
      } as unknown as jest.Mocked<EscalationService>;

      const service = new ClassificationService(
        permissionChecker,
        mockTranscriptClassifier,
        sessionState,
        mockEscalationService,
        ruleEvaluator,
        { ...DEFAULT_CONFIG, denyMode: 'both' } as any
      );

      const toolCall = createToolCall({ toolName: 'Bash' });

      await service.classify(toolCall);
      await service.classify(toolCall);
      await service.classify(toolCall);

      const counters = sessionState.getDenialCounters();
      expect(counters.consecutive).toBe(3);
      expect(counters.total).toBe(3);
    });
  });

  describe('deny-and-continue integration with classification', () => {
    it('should produce correct deny-and-continue result based on deny mode', async () => {
      const { DenyAndContinueService } = require('../../src/deny-and-continue/DenyAndContinueService');
      const sessionState = new SessionState();
      const config = { ...DEFAULT_CONFIG, denyMode: 'both', escalation: { consecutive: 3, total: 20 } };
      const service = new DenyAndContinueService(config as any, sessionState);

      const mockResult: ClassificationResult = {
        decision: 'deny',
        reasoning: 'Action blocked',
        blockRule: 'BR-001',
        stage: 1,
        timestamp: new Date(),
      };

      const denyResult = await service.handleDeny(mockResult);
      expect(denyResult.type).toBe('auto-retry');
    });
  });

  describe('rule evaluation in classification context', () => {
    it('should correctly evaluate block rules against tool calls', () => {
      const ruleEvaluator = new RuleEvaluator();
      const blockRules = [
        { id: 'BR-001', type: 'pattern' as const, pattern: 'rm -rf', category: 'dangerous', description: 'Block rm', severity: 'critical' as const, enabled: true },
        { id: 'BR-002', type: 'pattern' as const, pattern: 'chmod 777', category: 'permissions', description: 'Block chmod 777', severity: 'high' as const, enabled: true },
      ];
      const allowExceptions = [
        { id: 'AE-001', type: 'pattern' as const, pattern: 'safe-chmod', description: 'Allow safe chmod', enabled: true },
      ];

      const toolCall = createToolCall({ arguments: { command: 'rm -rf /important' } });
      const result = ruleEvaluator.evaluate(toolCall, blockRules, allowExceptions);

      expect(result.evaluation).toBe('blocked');
      expect(result.matchedRule).toBe('BR-001');
    });

    it('should allow exceptions to override block rules', () => {
      const ruleEvaluator = new RuleEvaluator();
      const blockRules = [
        { id: 'BR-001', type: 'pattern' as const, pattern: 'chmod', category: 'permissions', description: 'Block chmod', severity: 'high' as const, enabled: true },
      ];
      const allowExceptions = [
        { id: 'AE-001', type: 'pattern' as const, pattern: 'safe-chmod', description: 'Allow safe chmod', enabled: true },
      ];

      const toolCall = createToolCall({ arguments: { command: 'safe-chmod 644 /tmp/test' } });
      const result = ruleEvaluator.evaluate(toolCall, blockRules, allowExceptions);

      expect(result.evaluation).toBe('allowed');
      expect(result.matchedException).toBe('AE-001');
    });
  });
});
