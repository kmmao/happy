import { createId } from "@paralleldrive/cuid2";
import {
  createEnvelope,
  type SessionEnvelope,
  type SessionEvent,
  type SessionModelUsage,
  type SessionRole,
  type SessionTurnEndStatus,
} from "@kmmao/happy-wire";

/**
 * Turn lifecycle reducer — the single owner of the session-protocol Turn and
 * Subagent lifecycle (see CONTEXT.md: Turn, Subagent).
 *
 * Producers (Claude JSONL, Codex, ACP) decide WHICH SessionEvent happened and
 * WHICH Subagent it belongs to — that decision is provider-specific and stays
 * in each producer (Claude's sidechain resolution, Codex's tool-name fallback,
 * ACP's pending-text accumulation). This reducer owns the part that was
 * identical across all three and had silently drifted: lazily opening a Turn
 * before its first content, emitting a Subagent's `start` exactly once before
 * its first event, stamping every envelope with the current turn/subagent, and
 * closing the Turn — auto-stopping any Subagent still active — on `turn-end`.
 *
 * It is a pure function of (state, intent, clock): same inputs produce the same
 * envelopes, with no hidden mutation and no ambient clock. The clock is the
 * only impurity and is injected, so tests are fully deterministic. Illegal
 * intents (a `turnEnd` with no open Turn, a `subagentStop` for an inactive
 * Subagent) are lenient no-ops — this mirrors a live session and must never
 * throw mid-stream — but the no-op is observable as "0 envelopes emitted",
 * which is exactly what the tests assert.
 *
 * Schema and role invariants stay where they already live: in happy-wire's
 * `createEnvelope`/`sessionEnvelopeSchema`. This reducer adds the ORDERING
 * invariants (turn-start before content, start before stop, turn-end pairing)
 * that the wire schema cannot express.
 */

export type TurnMeta = {
  model?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  durationMs?: number;
  totalCostUsd?: number;
  numTurns?: number;
  modelUsage?: Record<string, SessionModelUsage>;
};

export type ProtocolState = {
  /** Open Turn id, or null when no Turn is open. */
  readonly currentTurnId: string | null;
  /** Subagents we have already emitted a `start` for (dedup, per Turn). */
  readonly startedSubagents: ReadonlySet<string>;
  /** Subagents started and not yet stopped. */
  readonly activeSubagents: ReadonlySet<string>;
};

export type ProtocolIntent =
  /** A non-lifecycle event. By default lazily opens a Turn if none is open —
   *  Claude infers Turn boundaries from its JSONL content. Set
   *  `openTurn: false` for producers with explicit Turn boundaries (Codex):
   *  content outside a Turn then stays Turn-less instead of forcing one open.
   *  `subagentTitle`, when set, titles the Subagent's `start` the first time it
   *  appears (provider-resolved, e.g. Claude's Task description); ignored once
   *  the Subagent has already started. */
  | {
      kind: "content";
      ev: SessionEvent;
      role?: SessionRole;
      subagent?: string;
      subagentTitle?: string;
      openTurn?: boolean;
      /** Optional Claude-side JSONL message UUID for the emitted envelope;
       *  used by the App as a precise rewind/fork anchor. Non-Claude producers
       *  leave this unset. */
      claudeUuid?: string;
    }
  /** Explicitly open a Turn now, for producers that have a provider turn-start
   *  signal (Codex `task_started`, ACP `startTurn`). Idempotent: a no-op while
   *  a Turn is already open. Producers without such a signal (Claude JSONL)
   *  rely on lazy-open via `content` instead — both paths coexist. */
  | { kind: "turnBegin" }
  /** Close the open Turn (auto-stops any still-active Subagent). */
  | { kind: "turnEnd"; status: SessionTurnEndStatus; meta?: TurnMeta }
  /** Stop one Subagent explicitly (before its Turn ends). */
  | { kind: "subagentStop"; subagent: string }
  /** Process exit / abort — finalize a still-open Turn as `cancelled` so the
   *  stream never leaves a dangling open Turn. No-op when no Turn is open. */
  | { kind: "reset" };

/** The reducer's only impurity, injected so the core stays deterministic. */
export type ProtocolClock = {
  now(): number;
  newId(): string;
};

export type ReduceResult = {
  state: ProtocolState;
  envelopes: SessionEnvelope[];
};

export const realClock: ProtocolClock = {
  now: () => Date.now(),
  newId: () => createId(),
};

export function initialProtocolState(): ProtocolState {
  return {
    currentTurnId: null,
    startedSubagents: new Set(),
    activeSubagents: new Set(),
  };
}

function turnEndEvent(
  status: SessionTurnEndStatus,
  meta: TurnMeta | undefined,
): SessionEvent {
  return {
    t: "turn-end",
    status,
    ...(meta?.model !== undefined ? { model: meta.model } : {}),
    ...(meta?.usage !== undefined ? { usage: meta.usage } : {}),
    ...(meta?.durationMs !== undefined ? { durationMs: meta.durationMs } : {}),
    ...(meta?.totalCostUsd !== undefined
      ? { totalCostUsd: meta.totalCostUsd }
      : {}),
    ...(meta?.numTurns !== undefined ? { numTurns: meta.numTurns } : {}),
    ...(meta?.modelUsage !== undefined ? { modelUsage: meta.modelUsage } : {}),
  };
}

export function reduce(
  state: ProtocolState,
  intent: ProtocolIntent,
  clock: ProtocolClock = realClock,
): ReduceResult {
  const envelopes: SessionEnvelope[] = [];
  let currentTurnId = state.currentTurnId;
  const startedSubagents = new Set(state.startedSubagents);
  const activeSubagents = new Set(state.activeSubagents);

  // Stamp every envelope with the Turn that is open at emit time. `currentTurnId`
  // is read live, so a `turn-start` emitted in the same step carries its own id.
  const emit = (
    ev: SessionEvent,
    opts: { role?: SessionRole; subagent?: string; claudeUuid?: string } = {},
  ): void => {
    envelopes.push(
      createEnvelope(opts.role ?? "agent", ev, {
        id: clock.newId(),
        time: clock.now(),
        ...(currentTurnId ? { turn: currentTurnId } : {}),
        ...(opts.subagent ? { subagent: opts.subagent } : {}),
        ...(opts.claudeUuid ? { claudeUuid: opts.claudeUuid } : {}),
      }),
    );
  };

  // Close the open Turn: stop any Subagent still active (so the App never sees
  // a dangling one), emit turn-end, then drop the Turn's lifecycle state.
  // Shared by the normal `turnEnd` and the abort `reset`.
  const closeTurn = (status: SessionTurnEndStatus, meta?: TurnMeta): void => {
    if (!currentTurnId) {
      return; // lenient no-op: nothing to close
    }
    for (const subagent of activeSubagents) {
      emit({ t: "stop" }, { subagent });
    }
    activeSubagents.clear();
    emit(turnEndEvent(status, meta));
    currentTurnId = null;
    startedSubagents.clear();
  };

  switch (intent.kind) {
    case "content": {
      if (intent.openTurn !== false && !currentTurnId) {
        currentTurnId = clock.newId();
        emit({ t: "turn-start" });
      }
      if (intent.subagent && !startedSubagents.has(intent.subagent)) {
        startedSubagents.add(intent.subagent);
        activeSubagents.add(intent.subagent);
        emit(
          {
            t: "start",
            ...(intent.subagentTitle ? { title: intent.subagentTitle } : {}),
          },
          { subagent: intent.subagent },
        );
      }
      emit(intent.ev, {
        role: intent.role,
        subagent: intent.subagent,
        claudeUuid: intent.claudeUuid,
      });
      break;
    }
    case "turnBegin": {
      if (!currentTurnId) {
        currentTurnId = clock.newId();
        emit({ t: "turn-start" });
      }
      break;
    }
    case "subagentStop": {
      if (activeSubagents.has(intent.subagent)) {
        activeSubagents.delete(intent.subagent);
        emit({ t: "stop" }, { subagent: intent.subagent });
      }
      break;
    }
    case "turnEnd": {
      closeTurn(intent.status, intent.meta);
      break;
    }
    case "reset": {
      closeTurn("cancelled");
      break;
    }
    default: {
      const _exhaustive: never = intent;
      void _exhaustive;
    }
  }

  return {
    state: { currentTurnId, startedSubagents, activeSubagents },
    envelopes,
  };
}
