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
 * State shape shared by Providers that embed the three `ProtocolState` fields
 * directly, under the same names, with the two Subagent Sets optional/lazily
 * initialised. Claude and Codex both match this; only their *other* fields
 * (sidechain maps, `parent_call_id` maps) differ.
 */
type EmbeddedProtocolState = {
  currentTurnId: string | null;
  startedSubagents?: ReadonlySet<string>;
  activeSubagents?: ReadonlySet<string>;
};

/**
 * The `ProviderAdapter` for any Provider whose state embeds the reducer's three
 * fields inline (see `EmbeddedProtocolState`). `liftProtocol` reads them
 * (defaulting an absent Set to empty); `writeProtocol` spreads the Provider
 * state and merges fresh copies back. This collapses the byte-for-byte
 * identical Claude and Codex adapters into one — a Provider whose protocol view
 * is stored differently, or that *is* a `ProtocolState` (ACP), still writes its
 * own adapter. Per ADR-0025 the contract stays two pure functions, not a class.
 */
export function embeddedProtocolAdapter<
  T extends EmbeddedProtocolState,
>(): ProviderAdapter<T> {
  return {
    liftProtocol(state) {
      return {
        currentTurnId: state.currentTurnId,
        startedSubagents: state.startedSubagents ?? new Set<string>(),
        activeSubagents: state.activeSubagents ?? new Set<string>(),
      };
    },
    writeProtocol(state, next) {
      return {
        ...state,
        currentTurnId: next.currentTurnId,
        startedSubagents: new Set(next.startedSubagents),
        activeSubagents: new Set(next.activeSubagents),
      };
    },
  };
}

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
