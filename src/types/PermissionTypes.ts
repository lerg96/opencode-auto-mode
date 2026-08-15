export interface PermissionResult {
  allowed: boolean;
  reason: 'explicit-allow-agent' | 'explicit-allow-global' | 'not-explicitly-allowed' | 'excluded-agent';
}
