import { describe, it, expect, vi } from "vitest";
import {
  SessionMessageCursor,
  SessionMessageCursorRegistry,
  SEEN_IDS_CAP,
} from "./sessionMessageCursor";

function makeCursor(initialSeq = 0) {
  const save = vi.fn();
  return { save, cursor: new SessionMessageCursor("s1", save, initialSeq) };
}

describe("SessionMessageCursor.advanceTo (single seq write point)", () => {
  it("advances forward and persists on every real advance", () => {
    const { save, cursor } = makeCursor();

    expect(cursor.advanceTo(5)).toBe(true);
    expect(cursor.lastSeq()).toBe(5);
    expect(save).toHaveBeenCalledWith("s1", 5);

    expect(cursor.advanceTo(8)).toBe(true);
    expect(cursor.lastSeq()).toBe(8);
    expect(save).toHaveBeenLastCalledWith("s1", 8);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("never moves backward and does not persist a non-advance", () => {
    const { save, cursor } = makeCursor(10);

    expect(cursor.advanceTo(10)).toBe(false); // equal — no-op
    expect(cursor.advanceTo(3)).toBe(false); // lower — no-op
    expect(cursor.lastSeq()).toBe(10);
    expect(save).not.toHaveBeenCalled();
  });

  it("seeds lastSeq from the persisted initial value", () => {
    const { cursor } = makeCursor(42);
    expect(cursor.lastSeq()).toBe(42);
  });
});

describe("SessionMessageCursor.classifyIncoming", () => {
  it("classifies the next seq as consecutive", () => {
    const { cursor } = makeCursor(7);
    expect(cursor.classifyIncoming(8)).toBe("consecutive");
  });

  it("classifies a seq beyond the next as a gap", () => {
    const { cursor } = makeCursor(7);
    expect(cursor.classifyIncoming(10)).toBe("gap");
  });

  it("classifies a seq at or below lastSeq as an echo", () => {
    const { cursor } = makeCursor(7);
    expect(cursor.classifyIncoming(7)).toBe("echo");
    expect(cursor.classifyIncoming(3)).toBe("echo");
  });

  it("treats the first message (seq 1, cursor 0) as consecutive", () => {
    const { cursor } = makeCursor(0);
    expect(cursor.classifyIncoming(1)).toBe("consecutive");
  });

  it("does not mutate the cursor", () => {
    const { save, cursor } = makeCursor(7);
    cursor.classifyIncoming(99);
    expect(cursor.lastSeq()).toBe(7);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("SessionMessageCursor.markApplied (live dedup)", () => {
  it("returns new the first time and duplicate on replay", () => {
    const { cursor } = makeCursor();
    expect(cursor.markApplied("m1")).toBe("new");
    expect(cursor.markApplied("m1")).toBe("duplicate");
  });

  it("tracks distinct ids independently", () => {
    const { cursor } = makeCursor();
    expect(cursor.markApplied("a")).toBe("new");
    expect(cursor.markApplied("b")).toBe("new");
    expect(cursor.markApplied("a")).toBe("duplicate");
  });

  it("evicts the oldest id once past the cap", () => {
    const { cursor } = makeCursor();
    // Fill to cap with unique ids.
    for (let i = 0; i < SEEN_IDS_CAP; i++) {
      expect(cursor.markApplied(`id-${i}`)).toBe("new");
    }
    // One more evicts the oldest ("id-0").
    expect(cursor.markApplied("overflow")).toBe("new");
    // The evicted oldest is now treated as new again.
    expect(cursor.markApplied("id-0")).toBe("new");
    // A still-retained recent id remains a duplicate.
    expect(cursor.markApplied(`id-${SEEN_IDS_CAP - 1}`)).toBe("duplicate");
  });
});

describe("SessionMessageCursor — dual path single ownership", () => {
  it("backfill advance and live advance share one seq + one persist point", () => {
    const { save, cursor } = makeCursor();

    // Backfill computes a cursorSeq (via resolveMessageCursorAdvance elsewhere)
    // and funnels it through advanceTo.
    cursor.advanceTo(20);
    // A live push at seq 21 is consecutive against the backfilled cursor.
    expect(cursor.classifyIncoming(21)).toBe("consecutive");
    cursor.advanceTo(21);

    expect(cursor.lastSeq()).toBe(21);
    expect(save).toHaveBeenNthCalledWith(1, "s1", 20);
    expect(save).toHaveBeenNthCalledWith(2, "s1", 21);
  });

  it("releaseDedup keeps seq but forgets applied ids (LRU eviction)", () => {
    const { cursor } = makeCursor(15);
    cursor.markApplied("m1");
    cursor.releaseDedup();
    expect(cursor.lastSeq()).toBe(15); // seq survives
    expect(cursor.markApplied("m1")).toBe("new"); // dedup reset
  });
});

describe("SessionMessageCursorRegistry (single owner)", () => {
  it("seeds a cursor's seq from persisted state on first access", () => {
    const save = vi.fn();
    const reg = new SessionMessageCursorRegistry(
      save,
      new Map([["s1", 30]]),
    );
    expect(reg.get("s1").lastSeq()).toBe(30);
    // Unknown session seeds at 0.
    expect(reg.get("s2").lastSeq()).toBe(0);
  });

  it("returns the same cursor instance per session", () => {
    const reg = new SessionMessageCursorRegistry(vi.fn());
    expect(reg.get("s1")).toBe(reg.get("s1"));
  });

  it("delete forgets seq and dedup", () => {
    const save = vi.fn();
    const reg = new SessionMessageCursorRegistry(save);
    reg.get("s1").advanceTo(9);
    reg.delete("s1");
    // A fresh cursor starts back at 0.
    expect(reg.get("s1").lastSeq()).toBe(0);
  });

  it("seed before first access primes the seq; seed after advances", () => {
    const reg = new SessionMessageCursorRegistry(vi.fn());
    reg.seed("s1", 12); // before get
    expect(reg.get("s1").lastSeq()).toBe(12);
    reg.seed("s1", 20); // after get → advances
    expect(reg.get("s1").lastSeq()).toBe(20);
    reg.seed("s1", 5); // lower → no-op
    expect(reg.get("s1").lastSeq()).toBe(20);
  });

  describe("peekSeq (read without creating a cursor)", () => {
    it("returns the persisted seed when no cursor has been created yet", () => {
      const reg = new SessionMessageCursorRegistry(
        vi.fn(),
        new Map([["s1", 30]]),
      );
      // peek must not create a cursor — only seeds exist here.
      expect(reg.peekSeq("s1")).toBe(30);
      expect(reg.has("s1")).toBe(false);
    });

    it("returns the live cursor's latest seq once created and advanced", () => {
      const reg = new SessionMessageCursorRegistry(vi.fn());
      reg.get("s1").advanceTo(42);
      expect(reg.peekSeq("s1")).toBe(42);
    });

    it("returns 0 when neither a cursor nor a seed exists", () => {
      const reg = new SessionMessageCursorRegistry(vi.fn());
      expect(reg.peekSeq("unknown")).toBe(0);
    });
  });
});
