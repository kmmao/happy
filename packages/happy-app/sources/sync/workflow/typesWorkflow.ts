/**
 * App-side representation of a Claude Code Workflow run, folded from the
 * sequence of `workflow-*` session-protocol envelopes that the CLI emits.
 *
 * The wire defines five raw event types (see wire/sessionProtocol.ts):
 *   workflow-run-start    →   creates a WorkflowRunState
 *   workflow-phase-start  →   appends to WorkflowRunState.phases
 *   workflow-agent-start  →   adds to WorkflowRunState.agents
 *   workflow-agent-end    →   patches a WorkflowAgentState
 *   workflow-run-end      →   closes WorkflowRunState (terminal status + totals)
 *
 * This module deliberately does NOT depend on React, Zustand, or any
 * UI/storage layer — the reducer is a pure (state, event) → state function
 * so it can be unit-tested in isolation and reused from multiple
 * subscribers (e.g. the chat reducer for inline rendering and the project
 * dashboard for top-level summaries).
 */

import type {
  SessionWorkflowAgentEndEvent,
  SessionWorkflowAgentStartEvent,
  SessionWorkflowPhaseStartEvent,
  SessionWorkflowRunEndEvent,
  SessionWorkflowRunStartEvent,
  WorkflowTokenStats,
} from "@kmmao/happy-wire";

/**
 * Discriminated union of the five workflow envelope event variants.
 *
 * Wire exports each variant individually but not as a pre-composed union —
 * we assemble it here so consumers can pattern-match on `event.t`. Adding
 * a new workflow event in wire requires adding it here too (a Zod parse
 * upstream rejects unknown variants before reaching the reducer).
 */
export type WorkflowEvent =
  | SessionWorkflowRunStartEvent
  | SessionWorkflowPhaseStartEvent
  | SessionWorkflowAgentStartEvent
  | SessionWorkflowAgentEndEvent
  | SessionWorkflowRunEndEvent;

export type WorkflowAgentStatus = "running" | "completed" | "errored" | "skipped";
export type WorkflowRunStatus = "running" | "completed" | "errored" | "aborted";

export interface WorkflowAgentState {
  agentId: string;
  status: WorkflowAgentStatus;
  /** Wall-clock when the agent-start event was observed by the reducer. */
  startedAt: number;
  /** Wall-clock from the agent-end event. */
  endedAt?: number;
  /** Echoed from the end event for convenience (endedAt - startedAt). */
  durationMs?: number;
  /** Optional label passed by agent(opts.label). */
  label?: string;
  /** Phase title at time of dispatch, when inside phase(). */
  phase?: string;
  /** Set when the agent was spawned by a nested workflow() call. */
  parentAgentId?: string;
  /** Siblings spawned by the same parallel() / pipeline() share an id. */
  parallelGroupId?: string;
  /** First ~500 chars of the prompt passed to agent(). */
  promptPreview?: string;
  /** True when agent() was called with a schema option. */
  hasSchema?: boolean;
  /** First ~500 chars of agent return value (text or JSON.stringified). */
  outputPreview?: string;
  /** Error text when status === "errored". */
  errorMessage?: string;
  /** Token usage from the agent's SDK transcript (if available). */
  tokens?: WorkflowTokenStats;
}

export interface WorkflowPhaseState {
  title: string;
  /** 0-based index in observed phase order (NOT meta.phases index). */
  index: number;
  /** Wall-clock when the phase-start event was observed. */
  startedAt?: number;
  /** AgentIds dispatched while this phase was active (preserves order). */
  agentIds: string[];
}

export interface WorkflowRunState {
  runId: string;
  /** Outer Workflow tool-use id; ties the run back to the message stream. */
  toolUseId: string;
  /** meta.name from the script. */
  name: string;
  /** meta.description from the script. */
  description: string;
  /** Pre-declared phases from meta.phases (may be empty). */
  phasesMeta: ReadonlyArray<{ title: string; detail?: string }>;
  /** Observed phases in arrival order (driven by workflow-phase-start). */
  phases: WorkflowPhaseState[];
  /** Agent state keyed by agentId for O(1) patching. */
  agents: Record<string, WorkflowAgentState>;
  /** Arrival-ordered agentIds; preserves "first observed" sequence. */
  agentOrder: string[];
  status: WorkflowRunStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  /** From workflow-run-end. */
  agentCount?: number;
  /** From workflow-run-end. */
  totalTokens?: number;
}

/**
 * Map keyed by runId. The reducer maintains this collection; UI selectors
 * read it via `Object.values()` filtered by `status === "running"` etc.
 */
export type WorkflowRunsMap = Readonly<Record<string, WorkflowRunState>>;

export const EMPTY_WORKFLOW_RUNS: WorkflowRunsMap = Object.freeze({});
