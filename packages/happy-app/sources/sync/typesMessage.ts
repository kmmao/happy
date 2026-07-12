import { AgentEvent } from "./typesRaw";
import { MessageMeta } from "./typesMessageMeta";

export type ToolCall = {
  /** SDK tool_use.id. Absent for tool calls synthesized locally from permission requests. */
  id?: string;
  name: string;
  state: "running" | "completed" | "error";
  input: any;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  description: string | null;
  result?: any;
  permission?: {
    id: string;
    status: "pending" | "approved" | "denied" | "canceled";
    reason?: string;
    mode?: string;
    allowedTools?: string[];
    decision?: "approved" | "approved_for_session" | "denied" | "abort";
    date?: number;
    answers?: Record<string, string>;
    /** Auto Mode safety classification (Phase 1) — drives danger highlighting. */
    riskLevel?: "safe" | "dangerous" | "neutral";
    classifierReason?: string;
  };
  /** Background task ID when Bash command runs with run_in_background */
  backgroundTaskId?: string;
  /** Path to the task output file on the CLI machine */
  outputFile?: string;
};

// Flattened message types - each message represents a single block
export type UserTextMessage = {
  kind: "user-text";
  id: string;
  /** SDK real message UUID — used for rewindFiles RPC */
  realId: string | null;
  localId: string | null;
  createdAt: number;
  text: string;
  displayText?: string; // Optional text to display in UI instead of actual text
  meta?: MessageMeta;
};

export type ModeSwitchMessage = {
  kind: "agent-event";
  id: string;
  /** Server DB message ID — used for dedup on cache restore */
  realID?: string | null;
  createdAt: number;
  event: AgentEvent;
  meta?: MessageMeta;
  // Session-level cumulative usage injected by reducer on "ready" events
  sessionUsage?: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd?: number;
  };
};

export type TaskStatusMessage = {
  status: "start" | "progress" | "completed" | "failed" | "stopped";
  summary: string;
  metrics: string | null;
};

export type AgentTextMessage = {
  kind: "agent-text";
  id: string;
  /** Server DB message ID — used for dedup on cache restore */
  realID?: string | null;
  localId: string | null;
  createdAt: number;
  text: string;
  isThinking?: boolean;
  taskStatus?: TaskStatusMessage;
  meta?: MessageMeta;
};

export type ToolCallMessage = {
  kind: "tool-call";
  id: string;
  /** Server DB message ID — used for dedup on cache restore */
  realID?: string | null;
  localId: string | null;
  createdAt: number;
  tool: ToolCall;
  children: Message[];
  meta?: MessageMeta;
};

export type Message =
  | UserTextMessage
  | AgentTextMessage
  | ToolCallMessage
  | ModeSwitchMessage;
