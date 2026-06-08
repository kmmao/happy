import { describe, expect, it } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import { CLAUDE_ADAPTER } from "@/claude/utils/sessionProtocolMapper";
import { CODEX_ADAPTER } from "@/codex/utils/sessionProtocolMapper";
import { ACP_ADAPTER } from "@/agent/acp/AcpSessionManager";
import {
  initialProtocolState,
  type ProtocolClock,
} from "./turnReducer";
import { applyToProvider, type ProviderAdapter } from "./providerAdapter";

/**
 * ProviderAdapter contract (ADR-0025). The Turn / Subagent lifecycle
 * invariants belong to the reducer; the Adapter only bridges state shapes.
 * These tests run the same intent sequences through every Provider's Adapter
 * and assert the invariants hold uniformly — a future fourth Provider
 * (say a Gemini stream mapper) only needs to add its Adapter to the test
 * table to inherit the same guarantees.
 *
 * Per-Provider signal extraction (Claude's sidechain UUID maps, Codex's
 * `parent_call_id` resolution, ACP's pending-stream-type accumulation) is
 * NOT covered here — it lives in each mapper's own test file because it is
 * genuinely Provider-specific.
 */

// A deterministic clock so test envelopes are comparable across runs.
function fakeClock(): ProtocolClock {
  let counter = 0;
  return {
    now: () => ++counter,
    newId: () => `id-${++counter}`,
  };
}

const ADAPTERS: ReadonlyArray<[string, ProviderAdapter<any>, () => unknown]> = [
  ["Claude", CLAUDE_ADAPTER, () => ({ currentTurnId: null })],
  ["Codex", CODEX_ADAPTER, () => ({ currentTurnId: null })],
  ["ACP", ACP_ADAPTER, () => initialProtocolState()],
];

describe.each(ADAPTERS)(
  "ProviderAdapter contract — %s",
  (_name, adapter, makeInitial) => {
    function run(
      initial: unknown,
      intents: Parameters<typeof applyToProvider>[2][],
    ): {
      state: unknown;
      envelopes: ReturnType<typeof applyToProvider>["envelopes"];
    } {
      const clock = fakeClock();
      let state = initial;
      const envelopes: ReturnType<typeof applyToProvider>["envelopes"] = [];
      for (const intent of intents) {
        const r = applyToProvider(adapter as any, state, intent, clock);
        state = r.state;
        envelopes.push(...r.envelopes);
      }
      return { state, envelopes };
    }

    it("turnBegin then turnEnd produces exactly [turn-start, turn-end]", () => {
      const { envelopes } = run(makeInitial(), [
        { kind: "turnBegin" },
        { kind: "turnEnd", status: "completed" },
      ]);
      expect(envelopes.map((e) => e.ev.t)).toEqual(["turn-start", "turn-end"]);
    });

    it("turnBegin is idempotent while a Turn is open", () => {
      const { envelopes } = run(makeInitial(), [
        { kind: "turnBegin" },
        { kind: "turnBegin" },
      ]);
      expect(envelopes.map((e) => e.ev.t)).toEqual(["turn-start"]);
    });

    it("content with openTurn=false does NOT lazily open a Turn", () => {
      const { envelopes } = run(makeInitial(), [
        {
          kind: "content",
          ev: { t: "text", text: "hi" },
          openTurn: false,
        },
      ]);
      const turnStarts = envelopes.filter((e) => e.ev.t === "turn-start");
      expect(turnStarts).toHaveLength(0);
      // The content envelope carries no `turn` field because no Turn is open.
      expect(envelopes[0]?.turn).toBeUndefined();
    });

    it("content with default openTurn lazily opens exactly one Turn", () => {
      const { envelopes } = run(makeInitial(), [
        { kind: "content", ev: { t: "text", text: "a" } },
        { kind: "content", ev: { t: "text", text: "b" } },
        { kind: "content", ev: { t: "text", text: "c" } },
      ]);
      const turnStarts = envelopes.filter((e) => e.ev.t === "turn-start");
      expect(turnStarts).toHaveLength(1);
    });

    it("turnEnd auto-stops EVERY active Subagent before emitting turn-end", () => {
      const subA = createId();
      const subB = createId();
      const { envelopes } = run(makeInitial(), [
        { kind: "turnBegin" },
        {
          kind: "content",
          ev: { t: "text", text: "x" },
          subagent: subA,
        },
        {
          kind: "content",
          ev: { t: "text", text: "y" },
          subagent: subB /* concurrent */,
        },
        { kind: "turnEnd", status: "completed" },
      ]);
      const stops = envelopes
        .map((e, i) => ({ t: e.ev.t, subagent: e.subagent, i }))
        .filter((e) => e.t === "stop");
      expect(stops).toHaveLength(2);
      expect(new Set(stops.map((s) => s.subagent))).toEqual(
        new Set([subA, subB]),
      );
      // turn-end is strictly AFTER every stop — the load-bearing ordering.
      const turnEndIdx = envelopes.findIndex((e) => e.ev.t === "turn-end");
      for (const stop of stops) {
        expect(stop.i).toBeLessThan(turnEndIdx);
      }
    });

    it("subagentStop for an unknown Subagent is a lenient no-op", () => {
      const { envelopes } = run(makeInitial(), [
        { kind: "turnBegin" },
        { kind: "subagentStop", subagent: createId() },
        { kind: "turnEnd", status: "completed" },
      ]);
      const stops = envelopes.filter((e) => e.ev.t === "stop");
      expect(stops).toHaveLength(0);
    });

    it("reset closes a still-open Turn as cancelled", () => {
      const subA = createId();
      const { envelopes } = run(makeInitial(), [
        { kind: "turnBegin" },
        {
          kind: "content",
          ev: { t: "text", text: "x" },
          subagent: subA,
        },
        { kind: "reset" },
      ]);
      const turnEnd = envelopes.find((e) => e.ev.t === "turn-end");
      expect(turnEnd).toBeDefined();
      expect((turnEnd!.ev as { status?: string }).status).toBe("cancelled");
      // Auto-stop survives reset too.
      const stops = envelopes.filter((e) => e.ev.t === "stop");
      expect(stops).toHaveLength(1);
    });

    it("a Subagent's start event fires exactly once across multiple content emits", () => {
      const subA = createId();
      const { envelopes } = run(makeInitial(), [
        { kind: "turnBegin" },
        { kind: "content", ev: { t: "text", text: "1" }, subagent: subA },
        { kind: "content", ev: { t: "text", text: "2" }, subagent: subA },
        { kind: "content", ev: { t: "text", text: "3" }, subagent: subA },
        { kind: "turnEnd", status: "completed" },
      ]);
      const starts = envelopes.filter((e) => e.ev.t === "start");
      expect(starts).toHaveLength(1);
    });
  },
);
