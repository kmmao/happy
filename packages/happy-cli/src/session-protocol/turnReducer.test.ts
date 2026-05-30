import { describe, it, expect } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import type { SessionEnvelope } from "@kmmao/happy-wire";
import {
  reduce,
  initialProtocolState,
  type ProtocolClock,
  type ProtocolIntent,
  type ProtocolState,
} from "./turnReducer";

// ── Deterministic clock ──────────────────────────────────────────────────────
// Monotonic time + valid cuid2 ids. Subagent ids on the wire must be cuid2
// (sessionEnvelopeSchema refines them), so we mint real ones rather than fakes.
function testClock(): ProtocolClock {
  let t = 0;
  return {
    now: () => ++t,
    newId: () => createId(),
  };
}

// Fold a sequence of intents through the reducer, returning the flat envelope
// stream and the final state — the shape every test reasons over.
function run(
  intents: ProtocolIntent[],
  clock: ProtocolClock = testClock(),
): { envelopes: SessionEnvelope[]; state: ProtocolState } {
  let state = initialProtocolState();
  const envelopes: SessionEnvelope[] = [];
  for (const intent of intents) {
    const result = reduce(state, intent, clock);
    state = result.state;
    envelopes.push(...result.envelopes);
  }
  return { envelopes, state };
}

const types = (envelopes: SessionEnvelope[]): string[] =>
  envelopes.map((e) => e.ev.t);

const text = (s: string): ProtocolIntent => ({
  kind: "content",
  ev: { t: "text", text: s },
});

// ── Behavior table (the rows from the design) ────────────────────────────────
describe("turnReducer — behavior table", () => {
  it("lazily opens a Turn on the first content (turn-start, then ev)", () => {
    const { envelopes, state } = run([text("hi")]);
    expect(types(envelopes)).toEqual(["turn-start", "text"]);
    expect(state.currentTurnId).not.toBeNull();
    // Both envelopes carry the same (just-opened) turn id.
    expect(envelopes[0].turn).toBe(envelopes[1].turn);
    expect(envelopes[0].turn).toBe(state.currentTurnId);
  });

  it("does not open a Turn when content sets openTurn: false (Codex)", () => {
    const { envelopes, state } = run([
      { kind: "content", ev: { t: "text", text: "x" }, openTurn: false },
    ]);
    expect(types(envelopes)).toEqual(["text"]);
    expect(envelopes[0].turn).toBeUndefined();
    expect(state.currentTurnId).toBeNull();
  });

  it("does not re-open a Turn for subsequent content", () => {
    const { envelopes } = run([text("a"), text("b")]);
    expect(types(envelopes)).toEqual(["turn-start", "text", "text"]);
  });

  it("emits a Subagent start exactly once before its first event", () => {
    const sub = createId();
    const { envelopes, state } = run([
      { kind: "content", ev: { t: "text", text: "x" }, subagent: sub },
      { kind: "content", ev: { t: "text", text: "y" }, subagent: sub },
    ]);
    expect(types(envelopes)).toEqual([
      "turn-start",
      "start",
      "text",
      "text",
    ]);
    // start + both texts are stamped with the subagent; turn-start is not.
    expect(envelopes[0].subagent).toBeUndefined();
    expect(envelopes[1].subagent).toBe(sub);
    expect(envelopes[2].subagent).toBe(sub);
    expect(envelopes[3].subagent).toBe(sub);
    expect(state.startedSubagents.has(sub)).toBe(true);
    expect(state.activeSubagents.has(sub)).toBe(true);
  });

  it("titles the Subagent start when subagentTitle is provided (once)", () => {
    const sub = createId();
    const { envelopes } = run([
      {
        kind: "content",
        ev: { t: "text", text: "x" },
        subagent: sub,
        subagentTitle: "Explore auth",
      },
      {
        kind: "content",
        ev: { t: "text", text: "y" },
        subagent: sub,
        subagentTitle: "ignored the second time",
      },
    ]);
    const starts = envelopes.filter((e) => e.ev.t === "start");
    expect(starts).toHaveLength(1);
    expect(starts[0].ev).toEqual({ t: "start", title: "Explore auth" });
  });

  it("stops an active Subagent and leaves it started but inactive", () => {
    const sub = createId();
    const { envelopes, state } = run([
      { kind: "content", ev: { t: "text", text: "x" }, subagent: sub },
      { kind: "subagentStop", subagent: sub },
    ]);
    expect(types(envelopes)).toEqual(["turn-start", "start", "text", "stop"]);
    expect(state.activeSubagents.has(sub)).toBe(false);
    expect(state.startedSubagents.has(sub)).toBe(true);
  });

  it("no-ops a subagentStop for an inactive Subagent", () => {
    const sub = createId();
    const { envelopes } = run([
      text("open the turn"),
      { kind: "subagentStop", subagent: sub },
    ]);
    expect(types(envelopes)).toEqual(["turn-start", "text"]);
  });

  it("turnEnd auto-stops every still-active Subagent, then closes", () => {
    const a = createId();
    const b = createId();
    const { envelopes, state } = run([
      { kind: "content", ev: { t: "text", text: "a" }, subagent: a },
      { kind: "content", ev: { t: "text", text: "b" }, subagent: b },
      { kind: "turnEnd", status: "completed" },
    ]);
    // turn-start, start@a, text@a, start@b, text@b, stop@a, stop@b, turn-end
    const stops = envelopes.filter((e) => e.ev.t === "stop");
    expect(stops.map((e) => e.subagent).sort()).toEqual([a, b].sort());
    expect(types(envelopes).slice(-1)).toEqual(["turn-end"]);
    expect(state.currentTurnId).toBeNull();
    expect(state.activeSubagents.size).toBe(0);
    expect(state.startedSubagents.size).toBe(0);
  });

  it("no-ops a turnEnd when no Turn is open", () => {
    const { envelopes, state } = run([{ kind: "turnEnd", status: "failed" }]);
    expect(envelopes).toEqual([]);
    expect(state.currentTurnId).toBeNull();
  });

  it("passes turn-end meta through onto the turn-end event", () => {
    const { envelopes } = run([
      text("work"),
      {
        kind: "turnEnd",
        status: "completed",
        meta: { model: "claude-opus-4-8", numTurns: 3, totalCostUsd: 0.12 },
      },
    ]);
    const end = envelopes.at(-1)!;
    expect(end.ev).toMatchObject({
      t: "turn-end",
      status: "completed",
      model: "claude-opus-4-8",
      numTurns: 3,
      totalCostUsd: 0.12,
    });
  });

  it("reset finalizes a still-open Turn as cancelled (no dangling turn)", () => {
    const sub = createId();
    const { envelopes, state } = run([
      { kind: "content", ev: { t: "text", text: "x" }, subagent: sub },
      { kind: "reset" },
    ]);
    expect(types(envelopes)).toEqual([
      "turn-start",
      "start",
      "text",
      "stop",
      "turn-end",
    ]);
    expect(envelopes.at(-1)!.ev).toMatchObject({
      t: "turn-end",
      status: "cancelled",
    });
    expect(state.currentTurnId).toBeNull();
    expect(state.activeSubagents.size).toBe(0);
    expect(state.startedSubagents.size).toBe(0);
  });

  it("no-ops a reset when no Turn is open", () => {
    const { envelopes, state } = run([{ kind: "reset" }]);
    expect(envelopes).toEqual([]);
    expect(state.currentTurnId).toBeNull();
  });

  it("opens a fresh Turn after the previous one ended", () => {
    const { envelopes } = run([
      text("first"),
      { kind: "turnEnd", status: "completed" },
      text("second"),
    ]);
    const turnStarts = envelopes.filter((e) => e.ev.t === "turn-start");
    expect(turnStarts).toHaveLength(2);
    expect(turnStarts[0].turn).not.toBe(turnStarts[1].turn);
  });

  it("threads claudeUuid onto content envelopes (fork anchor)", () => {
    const { envelopes } = run([
      {
        kind: "content",
        ev: { t: "text", text: "hi" },
        claudeUuid: "msg-uuid-1",
      },
    ]);
    expect(types(envelopes)).toEqual(["turn-start", "text"]);
    // turn-start is reducer-generated → no anchor.
    expect(envelopes[0].claudeUuid).toBeUndefined();
    // Content envelope carries the source record's UUID for fork purposes.
    expect(envelopes[1].claudeUuid).toBe("msg-uuid-1");
  });

  it("omits claudeUuid when intent does not supply one", () => {
    const { envelopes } = run([text("plain")]);
    for (const env of envelopes) {
      expect("claudeUuid" in env).toBe(false);
    }
  });
});

// ── Explicit turnBegin (for provider-driven turn-start signals) ──────────────
describe("turnReducer — explicit turnBegin", () => {
  it("opens a Turn eagerly with no content yet", () => {
    const { envelopes, state } = run([{ kind: "turnBegin" }]);
    expect(types(envelopes)).toEqual(["turn-start"]);
    expect(state.currentTurnId).toBe(envelopes[0].turn);
  });

  it("is idempotent while a Turn is already open", () => {
    const { envelopes } = run([{ kind: "turnBegin" }, { kind: "turnBegin" }]);
    expect(types(envelopes)).toEqual(["turn-start"]);
  });

  it("does not re-open the Turn for content after turnBegin", () => {
    const { envelopes } = run([{ kind: "turnBegin" }, text("hi")]);
    expect(types(envelopes)).toEqual(["turn-start", "text"]);
    expect(envelopes[0].turn).toBe(envelopes[1].turn);
  });

  it("brackets an empty Turn (turnBegin then turnEnd)", () => {
    const { envelopes, state } = run([
      { kind: "turnBegin" },
      { kind: "turnEnd", status: "completed" },
    ]);
    expect(types(envelopes)).toEqual(["turn-start", "turn-end"]);
    expect(state.currentTurnId).toBeNull();
  });
});

// ── Purity ───────────────────────────────────────────────────────────────────
describe("turnReducer — purity", () => {
  it("never mutates the input state", () => {
    const before = initialProtocolState();
    const snapshot = {
      currentTurnId: before.currentTurnId,
      started: [...before.startedSubagents],
      active: [...before.activeSubagents],
    };
    reduce(before, text("x"), testClock());
    expect(before.currentTurnId).toBe(snapshot.currentTurnId);
    expect([...before.startedSubagents]).toEqual(snapshot.started);
    expect([...before.activeSubagents]).toEqual(snapshot.active);
  });

  it("is referentially transparent for equal inputs", () => {
    const fixedClock: ProtocolClock = { now: () => 42, newId: () => "fixed-id" };
    const s = initialProtocolState();
    const a = reduce(s, text("x"), fixedClock);
    const b = reduce(s, text("x"), fixedClock);
    expect(a.envelopes).toEqual(b.envelopes);
  });
});

// ── Property tests over random intent sequences ──────────────────────────────
// A tiny seeded LCG keeps the generated sequences deterministic across runs.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function randomSequence(rng: () => number, length: number): ProtocolIntent[] {
  const subs = [createId(), createId(), createId()];
  const intents: ProtocolIntent[] = [];
  for (let i = 0; i < length; i++) {
    const roll = rng();
    if (roll < 0.45) {
      const useSub = rng() < 0.5;
      intents.push({
        kind: "content",
        ev: { t: "text", text: `m${i}` },
        ...(useSub ? { subagent: subs[Math.floor(rng() * subs.length)] } : {}),
      });
    } else if (roll < 0.58) {
      intents.push({
        kind: "subagentStop",
        subagent: subs[Math.floor(rng() * subs.length)],
      });
    } else if (roll < 0.7) {
      intents.push({ kind: "turnBegin" });
    } else if (roll < 0.9) {
      intents.push({ kind: "turnEnd", status: "completed" });
    } else {
      intents.push({ kind: "reset" });
    }
  }
  return intents;
}

describe("turnReducer — invariants over random sequences", () => {
  for (let seed = 1; seed <= 50; seed++) {
    it(`holds all ordering invariants (seed ${seed})`, () => {
      const rng = lcg(seed);
      const { envelopes } = run(randomSequence(rng, 40));

      // Walk the stream, tracking which Turn is open and which Subagents have
      // a live start, asserting the invariants at every step.
      let openTurn: string | null = null;
      const seenTurnStart = new Set<string>();
      let startedInTurn = new Set<string>();
      let activeInTurn = new Set<string>();

      for (const e of envelopes) {
        const t = e.ev.t;

        if (t === "turn-start") {
          // ① a turn-start opens a brand-new turn id, never a duplicate.
          expect(openTurn).toBeNull();
          expect(e.turn).toBeDefined();
          expect(seenTurnStart.has(e.turn!)).toBe(false);
          seenTurnStart.add(e.turn!);
          openTurn = e.turn!;
          startedInTurn = new Set();
          activeInTurn = new Set();
          continue;
        }

        // ② every non-turn-start envelope sits inside an open turn, stamped
        //    with that exact turn id.
        expect(openTurn).not.toBeNull();
        expect(e.turn).toBe(openTurn);

        if (t === "start") {
          // ③ a subagent starts at most once per turn.
          expect(e.subagent).toBeDefined();
          expect(startedInTurn.has(e.subagent!)).toBe(false);
          startedInTurn.add(e.subagent!);
          activeInTurn.add(e.subagent!);
        } else if (t === "stop") {
          // ④ a subagent only stops after a start, and only while active.
          expect(e.subagent).toBeDefined();
          expect(activeInTurn.has(e.subagent!)).toBe(true);
          activeInTurn.delete(e.subagent!);
        } else if (t === "turn-end") {
          // ⑤ turn-end closes the turn with no dangling active subagents.
          expect(activeInTurn.size).toBe(0);
          openTurn = null;
        }
      }
    });
  }
});
