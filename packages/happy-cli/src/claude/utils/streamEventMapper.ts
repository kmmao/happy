/**
 * streamEventMapper — converts SDK `stream_event` (SDKPartialAssistantMessage)
 * into session protocol `text-delta` envelopes for real-time streaming to App.
 *
 * The SDK's `includePartialMessages: true` option causes the Query iterator to
 * yield `{ type: 'stream_event', event: BetaRawMessageStreamEvent }` for each
 * SSE chunk from the Anthropic API. This module extracts the text/thinking
 * deltas and maps them to the existing `text-delta` wire protocol event that
 * the App already renders (originally built for Codex/ACP backends).
 *
 * Only `content_block_delta` events with `text_delta` or `thinking_delta`
 * payloads produce envelopes. All other stream event subtypes (message_start,
 * message_stop, content_block_start/stop, input_json_delta) are silently
 * dropped — the App reconstructs those from the full assistant messages.
 */

import { createEnvelope, type SessionEnvelope } from "@kmmao/happy-wire";
import { logger } from "@/lib";

/**
 * Loosely-typed stream event shape (avoids importing Beta types from
 * @anthropic-ai/sdk which are not re-exported by the agent SDK).
 */
interface StreamEventMessage {
  type: "stream_event";
  event: {
    type: string;
    delta?: {
      type: string;
      text?: string;
      thinking?: string;
    };
    index?: number;
  };
  parent_tool_use_id: string | null;
  uuid: string;
  session_id: string;
  ttft_ms?: number;
}

/** State tracked between stream events for a given response. */
export interface StreamEventMapperState {
  /** Current stream ID (content block index → stream id). */
  activeStreams: Map<number, string>;
  /** Monotonic counter for generating unique stream IDs. */
  streamCounter: number;
  /** Whether TTFT has been logged for this turn. */
  ttftLogged: boolean;
}

export function createStreamEventMapperState(): StreamEventMapperState {
  return {
    activeStreams: new Map(),
    streamCounter: 0,
    ttftLogged: false,
  };
}

/**
 * Map an SDK stream_event to zero or one `text-delta` session envelope.
 * Returns `null` for non-delta events.
 */
export function mapStreamEventToEnvelope(
  msg: StreamEventMessage,
  state: StreamEventMapperState,
  turnId: string | null,
): SessionEnvelope | null {
  const evt = msg.event;

  // Log TTFT on first delta
  if (!state.ttftLogged && msg.ttft_ms != null) {
    state.ttftLogged = true;
    logger.debug(`[streamEvent] TTFT: ${msg.ttft_ms}ms`);
  }

  if (evt.type === "content_block_start" && evt.index != null) {
    // Assign a stream ID for this content block
    const streamId = `cb-${state.streamCounter++}`;
    state.activeStreams.set(evt.index, streamId);
    return null;
  }

  if (evt.type === "content_block_stop" && evt.index != null) {
    state.activeStreams.delete(evt.index);
    return null;
  }

  if (evt.type !== "content_block_delta") return null;

  const delta = evt.delta;
  if (!delta) return null;

  const streamId = state.activeStreams.get(evt.index ?? 0) ?? `cb-${evt.index ?? 0}`;

  if (delta.type === "text_delta" && delta.text) {
    return createEnvelope(
      "agent",
      {
        t: "text-delta" as const,
        stream: streamId,
        delta: delta.text,
      },
      turnId ? { turn: turnId } : undefined,
    );
  }

  if (delta.type === "thinking_delta" && delta.thinking) {
    return createEnvelope(
      "agent",
      {
        t: "text-delta" as const,
        stream: streamId,
        delta: delta.thinking,
        thinking: true,
      },
      turnId ? { turn: turnId } : undefined,
    );
  }

  return null;
}
