export interface AgentRelease {
  available: boolean;
  source?: 'github' | 'local';
  version?: string;
  protocolVersion?: number;
  assetName?: string;
  sha256?: string;
  size?: number;
  downloadUrl?: string;
  releaseUrl?: string;
  publishedAt?: string;
  checkedAt: number;
  stale: boolean;
  error?: 'not_published' | 'check_failed' | 'disabled' | 'invalid_local_package';
}
export function newerVersion(candidate: string, installed: string): boolean {
  const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!pattern.test(candidate) || !pattern.test(installed)) return false;
  const next = candidate.split('.').map(Number);
  const previous = installed.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (next[i] !== previous[i]) return next[i] > previous[i];
  }
  return false;
}
