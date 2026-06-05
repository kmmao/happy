import { describe, it, expect } from "vitest";
import { createTerminalSequenceExtractor } from "./terminalSequences";

describe("createTerminalSequenceExtractor", () => {
  it("extracts a BEL-terminated window title (OSC 0)", () => {
    const ex = createTerminalSequenceExtractor();
    expect(ex.feed("\x1b]0;hello\x07")).toEqual([
      { kind: "windowTitle", title: "hello" },
    ]);
  });

  it("extracts a BEL-terminated window title (OSC 2)", () => {
    const ex = createTerminalSequenceExtractor();
    expect(ex.feed("\x1b]2;build done\x07")).toEqual([
      { kind: "windowTitle", title: "build done" },
    ]);
  });

  it("extracts a ST-terminated window title (ESC \\)", () => {
    const ex = createTerminalSequenceExtractor();
    expect(ex.feed("\x1b]0;ready\x1b\\")).toEqual([
      { kind: "windowTitle", title: "ready" },
    ]);
  });

  it("extracts iTerm2 notification (OSC 9)", () => {
    const ex = createTerminalSequenceExtractor();
    expect(ex.feed("\x1b]9;tests passed\x07")).toEqual([
      { kind: "notification", body: "tests passed" },
    ]);
  });

  it("emits 'bell' for a lone BEL outside an OSC frame", () => {
    const ex = createTerminalSequenceExtractor();
    expect(ex.feed("noise\x07more")).toEqual([{ kind: "bell" }]);
  });

  it("yields 'other' for unknown Ps codes so callers can decide", () => {
    const ex = createTerminalSequenceExtractor();
    expect(ex.feed("\x1b]52;c;ZGF0YQ==\x07")).toEqual([
      { kind: "other", ps: "52", payload: "c;ZGF0YQ==" },
    ]);
  });

  it("drops a malformed OSC frame (no ; separator) silently", () => {
    const ex = createTerminalSequenceExtractor();
    expect(ex.feed("\x1b]nope\x07")).toEqual([]);
  });

  it("buffers an OSC frame across chunk boundaries", () => {
    const ex = createTerminalSequenceExtractor();
    // Split right in the middle of the payload.
    expect(ex.feed("\x1b]0;par")).toEqual([]);
    expect(ex.feed("tial\x07")).toEqual([
      { kind: "windowTitle", title: "partial" },
    ]);
  });

  it("pairs ESC at end-of-chunk with ] at start-of-next-chunk", () => {
    const ex = createTerminalSequenceExtractor();
    expect(ex.feed("\x1b")).toEqual([]);
    expect(ex.feed("]0;split\x07")).toEqual([
      { kind: "windowTitle", title: "split" },
    ]);
  });

  it("handles ST split across chunks (ESC then \\)", () => {
    const ex = createTerminalSequenceExtractor();
    expect(ex.feed("\x1b]0;hi\x1b")).toEqual([]);
    expect(ex.feed("\\rest")).toEqual([{ kind: "windowTitle", title: "hi" }]);
  });

  it("recovers from runaway OSC by abandoning once cap is hit", () => {
    const ex = createTerminalSequenceExtractor();
    // 8KB of payload with no terminator — much larger than MAX_OSC_PAYLOAD.
    const garbage = "x".repeat(8192);
    expect(ex.feed("\x1b]0;" + garbage)).toEqual([]);
    // After the cap, parser should resync; a clean frame later still works.
    expect(ex.feed("\x1b]0;ok\x07")).toEqual([
      { kind: "windowTitle", title: "ok" },
    ]);
  });

  it("reset() drops in-flight OSC state", () => {
    const ex = createTerminalSequenceExtractor();
    ex.feed("\x1b]0;leftover");
    ex.reset();
    // Should not emit anything from the abandoned frame.
    expect(ex.feed("\x07")).toEqual([{ kind: "bell" }]);
  });

  it("yields multiple events from a single chunk", () => {
    const ex = createTerminalSequenceExtractor();
    expect(
      ex.feed("\x1b]2;t1\x07middle\x07\x1b]9;ping\x07"),
    ).toEqual([
      { kind: "windowTitle", title: "t1" },
      { kind: "bell" },
      { kind: "notification", body: "ping" },
    ]);
  });
});
