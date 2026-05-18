import { describe, it, expect } from "vitest";
import {
  mapStreamEventToEnvelope,
  createStreamEventMapperState,
} from "./streamEventMapper";

function makeStreamEvent(eventOverrides: Record<string, unknown> = {}) {
  return {
    type: "stream_event" as const,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "hello" },
      ...eventOverrides,
    },
    parent_tool_use_id: null,
    uuid: "test-uuid",
    session_id: "test-session",
  };
}

describe("mapStreamEventToEnvelope", () => {
  it("maps text_delta to text-delta envelope", () => {
    const state = createStreamEventMapperState();
    // Start a content block first
    mapStreamEventToEnvelope(
      makeStreamEvent({ type: "content_block_start", index: 0, delta: undefined }),
      state,
      "turn-1",
    );
    const result = mapStreamEventToEnvelope(
      makeStreamEvent(),
      state,
      "turn-1",
    );
    expect(result).not.toBeNull();
    expect(result!.ev.t).toBe("text-delta");
    expect(result!.role).toBe("agent");
    expect(result!.turn).toBe("turn-1");
    const ev = result!.ev as { t: string; delta: string; thinking?: boolean };
    expect(ev.delta).toBe("hello");
    expect(ev.thinking).toBeUndefined();
  });

  it("maps thinking_delta to text-delta envelope with thinking=true", () => {
    const state = createStreamEventMapperState();
    mapStreamEventToEnvelope(
      makeStreamEvent({ type: "content_block_start", index: 0, delta: undefined }),
      state,
      "turn-1",
    );
    const result = mapStreamEventToEnvelope(
      makeStreamEvent({
        delta: { type: "thinking_delta", thinking: "let me think..." },
      }),
      state,
      "turn-1",
    );
    expect(result).not.toBeNull();
    const ev = result!.ev as { t: string; delta: string; thinking?: boolean };
    expect(ev.t).toBe("text-delta");
    expect(ev.delta).toBe("let me think...");
    expect(ev.thinking).toBe(true);
  });

  it("returns null for message_start events", () => {
    const state = createStreamEventMapperState();
    const result = mapStreamEventToEnvelope(
      makeStreamEvent({ type: "message_start", delta: undefined }),
      state,
      "turn-1",
    );
    expect(result).toBeNull();
  });

  it("returns null for message_stop events", () => {
    const state = createStreamEventMapperState();
    const result = mapStreamEventToEnvelope(
      makeStreamEvent({ type: "message_stop", delta: undefined }),
      state,
      "turn-1",
    );
    expect(result).toBeNull();
  });

  it("returns null for content_block_start events", () => {
    const state = createStreamEventMapperState();
    const result = mapStreamEventToEnvelope(
      makeStreamEvent({ type: "content_block_start", index: 0, delta: undefined }),
      state,
      "turn-1",
    );
    expect(result).toBeNull();
  });

  it("returns null for content_block_stop events", () => {
    const state = createStreamEventMapperState();
    const result = mapStreamEventToEnvelope(
      makeStreamEvent({ type: "content_block_stop", index: 0, delta: undefined }),
      state,
      "turn-1",
    );
    expect(result).toBeNull();
  });

  it("returns null for input_json_delta", () => {
    const state = createStreamEventMapperState();
    const result = mapStreamEventToEnvelope(
      makeStreamEvent({
        delta: { type: "input_json_delta", partial_json: '{"foo":' },
      }),
      state,
      "turn-1",
    );
    expect(result).toBeNull();
  });

  it("assigns unique stream IDs per content block", () => {
    const state = createStreamEventMapperState();
    // Start two content blocks
    mapStreamEventToEnvelope(
      makeStreamEvent({ type: "content_block_start", index: 0, delta: undefined }),
      state,
      "turn-1",
    );
    mapStreamEventToEnvelope(
      makeStreamEvent({ type: "content_block_start", index: 1, delta: undefined }),
      state,
      "turn-1",
    );

    const r0 = mapStreamEventToEnvelope(
      makeStreamEvent({ index: 0, delta: { type: "text_delta", text: "a" } }),
      state,
      "turn-1",
    );
    const r1 = mapStreamEventToEnvelope(
      makeStreamEvent({ index: 1, delta: { type: "thinking_delta", thinking: "b" } }),
      state,
      "turn-1",
    );

    expect(r0).not.toBeNull();
    expect(r1).not.toBeNull();
    const stream0 = (r0!.ev as { stream: string }).stream;
    const stream1 = (r1!.ev as { stream: string }).stream;
    expect(stream0).not.toBe(stream1);
  });

  it("omits turn from envelope when turnId is null", () => {
    const state = createStreamEventMapperState();
    mapStreamEventToEnvelope(
      makeStreamEvent({ type: "content_block_start", index: 0, delta: undefined }),
      state,
      null,
    );
    const result = mapStreamEventToEnvelope(
      makeStreamEvent(),
      state,
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.turn).toBeUndefined();
  });
});

describe("createStreamEventMapperState", () => {
  it("starts with empty state", () => {
    const state = createStreamEventMapperState();
    expect(state.activeStreams.size).toBe(0);
    expect(state.streamCounter).toBe(0);
    expect(state.ttftLogged).toBe(false);
  });
});
