export type CheckStatus = 'pass' | 'fail' | 'not_checked' | 'error';
export interface Check { id: string; status: CheckStatus; detail: string }
export interface Artifact { path: string; sha256: string }
export interface CheckReport { checks: Check[]; artifacts: Artifact[] }
export type WorkerStatus = 'completed' | 'error' | 'timeout' | 'cancelled';
export interface WorkerResult {
  nativeGoal?: import("./native-goal.js").NativeGoal;
  acceptance?: import("./acceptance.js").Acceptance;
  status: WorkerStatus;
  sessionId?: string;
  durationMs: number;
  usage: unknown[];
  detail?: string;
}
export interface WorkerRequest {
  continuousGoal?: {objective:string;deadline:number;budgetId?:string};
  prompt: string;
  workspace: string;
  attemptDir: string;
  timeoutMs: number;
  sessionId?: string;
  signal?: AbortSignal;
}
export interface RunConfig {
  goal: string;
  mode: 'B0' | 'B1' | 'goal';
  requiredChecks?: string[];
  maxAttempts?: number;
  workspace: string;
  runDir: string;
  initialMs: number;
  repairMs: number;
  totalMs: number;
  provenance?: Record<string, unknown>;
}
export type RunStatus = 'running' | 'checking' | 'paused' | 'checks_passed' | 'checks_failed' | 'unverified' | 'error' | 'timeout' | 'cancelled';
export interface Attempt { number: number; worker?: WorkerResult; check?: CheckReport }
export interface RunState {
  id: string;
  config: RunConfig;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: RunStatus;
  reason?: string;
  attempts: Attempt[];
  finalGrade: null;
  actualCost: null;
}
export interface RunDependencies {
  worker: (request: WorkerRequest) => Promise<WorkerResult>;
  check: (workspace: string, attemptDir: string, signal?: AbortSignal) => Promise<CheckReport>;
  signal?: AbortSignal;
  onEvent?: (event: { type: string; at: string; data: unknown }) => void;
}
