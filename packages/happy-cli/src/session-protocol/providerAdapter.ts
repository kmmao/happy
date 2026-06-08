import type { SessionEnvelope } from "@kmmao/happy-wire";
import {
  type ProtocolClock,
  type ProtocolIntent,
  type ProtocolState,
  reduce,
} from "./turnReducer";

/**
 * Adapter contract every Provider (Claude JSONL, Codex, ACP, …) implements
 * to share the Turn lifecycle reducer (see CONTEXT.md: Provider, Turn).
 *
 * `ProtocolState` (currentTurnId + startedSubagents + activeSubagents) is the
 * subset of a Provider's per-stream state that the reducer owns. Each Provider
 * carries that subset embedded inside a richer Provider-specific state (Claude
 * tracks sidechain UUID maps and buffered Subagent messages; Codex tracks
 * `parent_call_id`-to-session-Subagent maps; ACP tracks pending stream-type
 * accumulation). The Adapter is a pure type contract: `liftProtocol` extracts
 * the reducer's view from the Provider's state; `writeProtocol` returns the
 * Provider state with a fresh reducer view merged in.
 *
 * The contract is intentionally two pure functions and not a class — see
 * ADR-0025 for the rejected class-based alternative.
 */
export type ProviderAdapter<T> = {
  liftProtocol(state: T): ProtocolState;
  writeProtocol(state: T, next: ProtocolState): T;
};

/**
 * Run one `ProtocolIntent` through the reducer on behalf of a Provider's
 * state. Returns the new Provider state plus the envelopes the reducer
 * emitted.
 *
 * This is the only function callers should use to integrate a Provider with
 * the reducer. The reducer's `reduce` remains the lifecycle owner; this helper
 * just bridges the type gap between `ProtocolState` and the Provider's larger
 * state without re-stating the lift/write dance at every call site.
 *
 * `clock` lets a Provider inject its own clock when its envelopes need a
 * Provider-specific time semantic (ACP uses a monotonic clock — see
 * ADR-0025). Omitting it uses the reducer's `realClock` default.
 */
export function applyToProvider<T>(
  adapter: ProviderAdapter<T>,
  state: T,
  intent: ProtocolIntent,
  clock?: ProtocolClock,
): { state: T; envelopes: SessionEnvelope[] } {
  const { state: next, envelopes } = reduce(
    adapter.liftProtocol(state),
    intent,
    clock,
  );
  return {
    state: adapter.writeProtocol(state, next),
    envelopes,
  };
}
