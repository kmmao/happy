/**
 * Pure folding logic that turns a sequence of `workflow-*` envelope events
 * into a per-runId `WorkflowRunState` collection.
 *
 * Design constraints:
 *   • IDEMPOTENT — replaying the same event must produce the same state
 *     (so resume / backfill loops don't double-count agents).
 *   • ORDER-TOLERANT — events can arrive out of order (e.g. agent-end
 *     before agent-start across a brief WebSocket disconnect). Handlers
 *     create placeholder shells when the prerequisite event is missing
 *     rather than dropping the late one on the floor.
 *   • IMMUTABLE — returns a new map / new run state when something
 *     changed, otherwise the SAME reference (so React selectors short-
 *     circuit on Object.is equality).
 *
 * The reducer does NOT compute parallel-group ids — `parallelGroupId` on
 * an agent is whatever the CLI emitted (PR 2b leaves it undefined). UI
 * components can heuristically group by `startedAt` proximity as a
 * selector if they want to render swim-lanes.
 */

import type {
  WorkflowAgentState,
  WorkflowEvent,
  WorkflowPhaseState,
  WorkflowRunState,
  WorkflowRunsMap,
} from "./typesWorkflow";

const EMPTY_PHASES_META: ReadonlyArray<{ title: string; detail?: string }> = Object.freeze([]);

/**
 * Apply one workflow event to the runs map. Returns a new map only when
 * the event produced an observable state change; otherwise returns the
 * input by reference.
 */
export function applyWorkflowEvent(
  runs: WorkflowRunsMap,
  event: WorkflowEvent,
): WorkflowRunsMap {
  switch (event.t) {
    case "workflow-run-start":
      return handleRunStart(runs, event);
    case "workflow-phase-start":
      return handlePhaseStart(runs, event);
    case "workflow-agent-start":
      return handleAgentStart(runs, event);
    case "workflow-agent-end":
      return handleAgentEnd(runs, event);
    case "workflow-run-end":
      return handleRunEnd(runs, event);
    default: {
      // Exhaustiveness — TS will flag if a new variant is added to the
      // WorkflowEvent union without a handler here.
      const _exhaustive: never = event;
      void _exhaustive;
      return runs;
    }
  }
}

/**
 * Fold a batch of events through `applyWorkflowEvent`, returning the final
 * map. Useful for replaying historical envelopes during App cold-start.
 */
export function applyWorkflowEvents(
  runs: WorkflowRunsMap,
  events: ReadonlyArray<WorkflowEvent>,
): WorkflowRunsMap {
  let next = runs;
  for (const event of events) {
    next = applyWorkflowEvent(next, event);
  }
  return next;
}

// ─── handlers ───────────────────────────────────────────────────────────────

function handleRunStart(
  runs: WorkflowRunsMap,
  event: Extract<WorkflowEvent, { t: "workflow-run-start" }>,
): WorkflowRunsMap {
  const existing = runs[event.runId];
  if (existing) {
    // Idempotent: a duplicate run-start (e.g. from resume) keeps the
    // existing run as-is. Don't reset agent state we may have already
    // collected from earlier events.
    return runs;
  }
  const run: WorkflowRunState = {
    runId: event.runId,
    toolUseId: event.toolUseId,
    name: event.name,
    description: event.description,
    phasesMeta: event.phases ?? EMPTY_PHASES_META,
    phases: [],
    agents: {},
    agentOrder: [],
    status: "running",
    startedAt: event.startedAt,
  };
  return { ...runs, [event.runId]: run };
}

function handlePhaseStart(
  runs: WorkflowRunsMap,
  event: Extract<WorkflowEvent, { t: "workflow-phase-start" }>,
): WorkflowRunsMap {
  const run = runs[event.runId] ?? createPlaceholderRun(event.runId, event.startedAt);
  // Idempotent: skip if a phase with this title is already recorded.
  if (run.phases.some((p) => p.title === event.title)) {
    return runs;
  }
  const newPhase: WorkflowPhaseState = {
    title: event.title,
    index: event.index,
    startedAt: event.startedAt,
    agentIds: [],
  };
  const nextRun: WorkflowRunState = {
    ...run,
    phases: [...run.phases, newPhase],
  };
  return { ...runs, [event.runId]: nextRun };
}

function handleAgentStart(
  runs: WorkflowRunsMap,
  event: Extract<WorkflowEvent, { t: "workflow-agent-start" }>,
): WorkflowRunsMap {
  const run = runs[event.runId] ?? createPlaceholderRun(event.runId, event.startedAt);
  if (run.agents[event.agentId]) {
    // Idempotent: a duplicate agent-start keeps existing state. Useful for
    // replay; also handles the rare case where the CLI emits the same line
    // twice due to a journal poll race.
    return runs;
  }
  const agent: WorkflowAgentState = {
    agentId: event.agentId,
    status: "running",
    startedAt: event.startedAt,
    label: event.label,
    phase: event.phase,
    parentAgentId: event.parentAgentId,
    parallelGroupId: event.parallelGroupId,
    promptPreview: event.promptPreview,
    hasSchema: event.hasSchema,
  };
  const nextRun: WorkflowRunState = {
    ...run,
    agents: { ...run.agents, [event.agentId]: agent },
    agentOrder: [...run.agentOrder, event.agentId],
    phases: event.phase
      ? attachAgentToPhase(run.phases, event.phase, event.agentId, event.startedAt)
      : run.phases,
  };
  return { ...runs, [event.runId]: nextRun };
}

function handleAgentEnd(
  runs: WorkflowRunsMap,
  event: Extract<WorkflowEvent, { t: "workflow-agent-end" }>,
): WorkflowRunsMap {
  const run = runs[event.runId] ?? createPlaceholderRun(event.runId, event.endedAt);
  const existingAgent = run.agents[event.agentId];
  // If agent-end races ahead of agent-start, materialize a minimal shell
  // so the terminal state isn't dropped. agent-start arriving later finds
  // an entry in `agents` and is skipped by handleAgentStart's idempotency
  // — which is the desired behaviour: end state is authoritative.
  const agent: WorkflowAgentState = existingAgent
    ? {
        ...existingAgent,
        status: event.status,
        endedAt: event.endedAt,
        durationMs: event.durationMs,
        outputPreview: event.outputPreview ?? existingAgent.outputPreview,
        errorMessage: event.errorMessage ?? existingAgent.errorMessage,
        tokens: event.tokens ?? existingAgent.tokens,
      }
    : {
        agentId: event.agentId,
        status: event.status,
        startedAt: event.endedAt - event.durationMs,
        endedAt: event.endedAt,
        durationMs: event.durationMs,
        outputPreview: event.outputPreview,
        errorMessage: event.errorMessage,
        tokens: event.tokens,
      };
  const wasInOrder = existingAgent !== undefined;
  const nextRun: WorkflowRunState = {
    ...run,
    agents: { ...run.agents, [event.agentId]: agent },
    // When agent-end created the agent (out-of-order), also append it to
    // agentOrder so UI iteration sees it.
    agentOrder: wasInOrder ? run.agentOrder : [...run.agentOrder, event.agentId],
  };
  return { ...runs, [event.runId]: nextRun };
}

function handleRunEnd(
  runs: WorkflowRunsMap,
  event: Extract<WorkflowEvent, { t: "workflow-run-end" }>,
): WorkflowRunsMap {
  const run = runs[event.runId] ?? createPlaceholderRun(event.runId, event.endedAt);
  const nextRun: WorkflowRunState = {
    ...run,
    status: event.status,
    endedAt: event.endedAt,
    durationMs: event.durationMs,
    agentCount: event.agentCount,
    totalTokens: event.totalTokens,
  };
  return { ...runs, [event.runId]: nextRun };
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal run shell when an event arrives for a run we haven't
 * seen a `workflow-run-start` for. The placeholder carries empty/unknown
 * fields so the UI can still show "Workflow run <runId>" while waiting
 * for the start event to arrive (or never, in degraded-stream cases).
 */
function createPlaceholderRun(runId: string, when: number): WorkflowRunState {
  return {
    runId,
    toolUseId: "",
    name: "",
    description: "",
    phasesMeta: EMPTY_PHASES_META,
    phases: [],
    agents: {},
    agentOrder: [],
    status: "running",
    startedAt: when,
  };
}

function attachAgentToPhase(
  phases: ReadonlyArray<WorkflowPhaseState>,
  phaseTitle: string,
  agentId: string,
  startedAt: number,
): WorkflowPhaseState[] {
  const idx = phases.findIndex((p) => p.title === phaseTitle);
  if (idx < 0) {
    // Agent declared a phase we haven't seen a phase-start for — append a
    // synthetic phase to preserve the agent's association. The phase's
    // index falls back to the count of currently-known phases, and its
    // startedAt approximates from the agent's own start time.
    return [
      ...phases,
      {
        title: phaseTitle,
        index: phases.length,
        startedAt,
        agentIds: [agentId],
      },
    ];
  }
  const existing = phases[idx]!;
  // Idempotent: don't duplicate agentIds on a phase. Preserve the original
  // array reference when nothing changes so downstream Object.is holds.
  if (existing.agentIds.includes(agentId)) return phases.slice();
  const updated: WorkflowPhaseState = {
    ...existing,
    agentIds: [...existing.agentIds, agentId],
  };
  return phases.map((p, i) => (i === idx ? updated : p));
}
