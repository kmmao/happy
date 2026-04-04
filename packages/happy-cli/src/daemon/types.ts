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
  happySessionId?: string;
  happySessionMetadataFromLocalWebhook?: Metadata;
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
}
