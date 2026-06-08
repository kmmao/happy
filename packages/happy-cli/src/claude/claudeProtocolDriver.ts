import type { SessionTurnEndStatus } from "@kmmao/happy-wire";
import type { RawJSONLines } from "@/claude/types";
import {
  closeClaudeTurnWithStatus,
  createClaudeProtocolState,
  mapClaudeLogMessageToSessionEnvelopes,
  type ClaudeMapperResult,
  type TurnMeta,
} from "@/claude/utils/sessionProtocolMapper";

/**
 * Owns the Claude Provider's per-session protocol state and the two mapper
 * invocations that advance it. The Session sync client (`ApiSessionClient`)
 * composes one of these instead of holding `ClaudeSessionProtocolState` and the
 * Claude mapper directly — so the sync client's interface stays Provider-
 * agnostic (a turn cursor + an envelope sink) the way it already is for Codex
 * and ACP, which drive their own mappers externally.
 *
 * The driver exposes only the turn cursor and the two ingest paths; all the
 * Claude-specific maps (subagent resolution, buffering, hidden tool calls) stay
 * hidden behind this seam. Per ADR-0025 the Turn / Subagent lifecycle
 * invariants still live in `turnReducer`; this module is purely the ownership
 * boundary for Claude's slice of that state.
 */
export type ClaudeProtocolDriver = {
  /** Current session-protocol turn ID, or null if no turn is open. */
  readonly currentTurnId: string | null;
  /** Force the turn cursor (used by the streaming and direct-result paths that open a turn outside the mapper). */
  setCurrentTurn(turnId: string): void;
  /** Map one raw Claude JSONL record into envelopes, advancing the turn cursor. */
  ingest(message: RawJSONLines): ClaudeMapperResult;
  /** Close the open turn with a status + optional meta, advancing the turn cursor. */
  closeTurn(status: SessionTurnEndStatus, meta?: TurnMeta): ClaudeMapperResult;
};

export function createClaudeProtocolDriver(): ClaudeProtocolDriver {
  const state = createClaudeProtocolState();

  return {
    get currentTurnId() {
      return state.currentTurnId;
    },
    setCurrentTurn(turnId: string) {
      state.currentTurnId = turnId;
    },
    ingest(message: RawJSONLines): ClaudeMapperResult {
      const mapped = mapClaudeLogMessageToSessionEnvelopes(message, state);
      state.currentTurnId = mapped.currentTurnId;
      return mapped;
    },
    closeTurn(status: SessionTurnEndStatus, meta?: TurnMeta): ClaudeMapperResult {
      const mapped = closeClaudeTurnWithStatus(state, status, meta);
      state.currentTurnId = mapped.currentTurnId;
      return mapped;
    },
  };
}
