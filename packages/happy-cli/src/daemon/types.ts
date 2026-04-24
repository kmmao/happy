/**
 * Daemon-specific types (not related to API/server communication)
 */

import { Metadata } from '@/api/types';
import { ChildProcess } from 'child_process';

/**
 * Session tracking for daemon
 */
export interface TrackedSession {
  startedBy: 'daemon' | string;
  startedAt?: number;
  lastActivityAt?: number;
  lastOutputAt?: number;
  terminationRequestedAt?: number;
  terminationReason?: string;
  automationContext?: {
    kind: "supervisor" | "webhook" | "agent_loop" | "task";
    trigger?: string;
    projectId?: string;
    runId?: string;
    loopId?: string;
    dedupeKey?: string;
  };
  /**
   * Daemon-generated UUID injected into the spawned child's args as
   * `--happy-spawn-id`. Populated for daemon-spawned sessions before the
   * child reports back via /session-started. Enables tracking pre-registration
   * (offline stub) children and serves as the heartbeat identity when the
   * server-assigned `happySessionId` is not yet known.
   */
  spawnId?: string;
  happySessionId?: string;
  happySessionMetadataFromLocalWebhook?: Metadata;
  /** Last wall-clock time the child posted to /session-heartbeat. */
  lastHeartbeatAt?: number;
  /** Most recent activity reported by the child via heartbeat payload. */
  activity?: "idle" | "thinking" | "executing" | "blocked";
  pid: number;
  childProcess?: ChildProcess;
  error?: string;
  directoryCreated?: boolean;
  message?: string;
  /** tmux session identifier (format: session:window) */
  tmuxSessionId?: string;
  /** True when restored from daemon-local persisted session index after restart. */
  recoveredFromIndex?: boolean;
  /** Recovery timestamp for sessions reattached after daemon restart. */
  recoveredAt?: number;
  /** Best-effort cleanup for daemon-local ephemeral resources. */
  cleanup?: () => Promise<void>;
}
