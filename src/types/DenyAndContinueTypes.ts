import type { DenyMode } from './PluginConfig';

export type { DenyMode };

export interface DenyAndContinueResult {
  type: DenyMode;
  message: string;
  requiresUserApproval?: boolean;
}
