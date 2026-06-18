/**
 * ClaudeTurnReducer — pure module owning the auto-compact slice of the
 * Claude PTY turn lifecycle.
 *
 * Why a reducer
 * -------------
 * The auto-compact protocol weaves four observation points around one
 * turn (see claudeRemote.ts for the wire-in):
 *
 *   1. launcher tells us "this prompt was `/compact`" before the paste lands
 *   2. scanner sees the TUI emit a `system`/`compact_boundary` JSONL record
 *      mid-turn (the canonical "compaction actually happened" signal)
 *   3. turn-end fires
 *   4. one of two outcomes ships:
 *        a) compact_boundary observed → "Compaction completed", no cooldown
 *        b) compact_boundary missing  → "Compaction skipped" + arm cooldown
 *
 * Previously two `let` flags (`isCompactCommand`, `compactBoundaryObserved`)
 * lived in a 1647-line closure, the turn-end branch hand-coded both outcomes,
 * and no test pinned any of it. Four bugs (echo-retry concat / missing no-op
 * event / misleading watchdog / cooldown miss) all originated from this
 * scatter — same shape spawns the next four.
 *
 * The reducer concentrates the state + state transitions so the protocol
 * invariants become a 6-case test suite, and the caller (claudeRemote.ts)
 * reacts to typed outputs instead of hand-coding the two-arm branch.
 *
 * Scope
 * -----
 * Phase A only: auto-compact slice. Strand detection and echo-retry stay in
 * the launcher this round — they have their own state machines worth
 * extracting later, but folding everything in now would inflate the seam
 * past what we can land in one PR.
 */

export type ReducerIntent =
  | { t: "promptIsCompact" }
  | { t: "turnStart" }
  | { t: "compactBoundary" }
  | { t: "turnEnd" };

export type ReducerOutput =
  | { t: "emitCompletion"; text: string }
  | { t: "armCooldown" };

export interface ReducerState {
  readonly isCompactCommand: boolean;
  readonly compactBoundaryObserved: boolean;
}

export const initialReducerState: ReducerState = {
  isCompactCommand: false,
  compactBoundaryObserved: false,
};

const COMPLETED_TEXT = "Compaction completed";
const SKIPPED_TEXT = "Compaction skipped — TUI did not compact this turn";

/**
 * Pure transition. Returns the next state and any outputs the caller should
 * apply (emit a completion event, arm the cooldown). Deterministic and
 * exhaustively switched — adding a new intent will fail typecheck without
 * a handler.
 */
export function reduceTurn(
  state: ReducerState,
  intent: ReducerIntent,
): { next: ReducerState; outputs: ReducerOutput[] } {
  switch (intent.t) {
    case "promptIsCompact":
      // Always reset prior observation — a fresh /compact intent
      // supersedes any leftover state, even across malformed turn
      // boundaries (a strand recovery that never delivered turnEnd, etc.).
      return {
        next: { isCompactCommand: true, compactBoundaryObserved: false },
        outputs: [],
      };

    case "turnStart":
      // Reserved for future invariants (turn watchdog timer, etc.).
      // Today the reducer doesn't need to react to turn-start; kept in
      // the intent set so the wire-in expresses the full lifecycle.
      return { next: state, outputs: [] };

    case "compactBoundary":
      // A boundary fired by some unrelated condition (no prior
      // promptIsCompact) is ignored — guards against spurious JSONL.
      if (!state.isCompactCommand) return { next: state, outputs: [] };
      // Idempotent — re-emission of the same JSONL must not flip state
      // twice; protects the "double boundary" invariant the closure
      // never explicitly tested.
      if (state.compactBoundaryObserved) return { next: state, outputs: [] };
      return {
        next: { ...state, compactBoundaryObserved: true },
        outputs: [],
      };

    case "turnEnd":
      if (!state.isCompactCommand) return { next: state, outputs: [] };
      if (state.compactBoundaryObserved) {
        return {
          next: initialReducerState,
          outputs: [{ t: "emitCompletion", text: COMPLETED_TEXT }],
        };
      }
      // Turn ended but no compact_boundary arrived — the TUI never
      // actually compacted (commonly because the bracketed-paste landed
      // as prose, e.g. `/compact/compact` from an echo-retry concat, or
      // the model handled `/compact` as plain text). Emit the truthful
      // status AND signal the cooldown so the launcher gates the next
      // over-threshold push.
      return {
        next: initialReducerState,
        outputs: [
          { t: "emitCompletion", text: SKIPPED_TEXT },
          { t: "armCooldown" },
        ],
      };
  }
}

/**
 * Stateful driver — small convenience so the caller doesn't thread state
 * manually. Holds the latest state, applies each intent through the pure
 * `reduceTurn`, returns the outputs. The pure function remains the test
 * surface; this is just the convenience wrapper.
 */
export function createClaudeTurnReducer(): {
  state: () => ReducerState;
  dispatch: (intent: ReducerIntent) => ReducerOutput[];
} {
  let state: ReducerState = initialReducerState;
  return {
    state: () => state,
    dispatch: (intent) => {
      const { next, outputs } = reduceTurn(state, intent);
      state = next;
      return outputs;
    },
  };
}
