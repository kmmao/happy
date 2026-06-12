import { describe, it, expect } from "vitest";
import { createTuiStatusParser } from "./tuiStatusParser";
import { createTerminalSequenceExtractor } from "./terminalSequences";

describe("tuiStatusParser — activity", () => {
  it("parses verb + seconds + token counter from a status line", () => {
    const parser = createTuiStatusParser(() => 0);
    const events = parser.feed(
      "\x1b[2K✶ Reasoning… (12s · 1.2k tokens · esc to interrupt)",
    );
    expect(events).toEqual([
      { kind: "activity", verb: "Reasoning", tokens: 1200, seconds: 12 },
    ]);
  });

  it("parses plain token counts without k suffix", () => {
    const parser = createTuiStatusParser(() => 0);
    const events = parser.feed("✻ Hatching… (telemetry · 342 tokens)");
    expect(events).toEqual([
      { kind: "activity", verb: "Hatching", tokens: 342, seconds: undefined },
    ]);
  });

  it("debounces counter-only updates within 1s but emits verb changes immediately", () => {
    let now = 0;
    const parser = createTuiStatusParser(() => now);
    expect(parser.feed("✶ Reasoning… (1s · 100 tokens)")).toHaveLength(1);
    // Same verb, new counters, 200ms later → suppressed.
    now = 200;
    expect(parser.feed("✶ Reasoning… (2s · 150 tokens)")).toHaveLength(0);
    // Verb change → immediate.
    expect(parser.feed("✶ Compacting… (2s · 150 tokens)")).toEqual([
      { kind: "activity", verb: "Compacting", tokens: 150, seconds: 2 },
    ]);
    // Counter update after the interval → emitted.
    now = 1300;
    expect(parser.feed("✶ Compacting… (3s · 250 tokens)")).toHaveLength(1);
  });

  it("matches a status line split across chunk boundaries", () => {
    const parser = createTuiStatusParser(() => 0);
    expect(parser.feed("✶ Reason")).toHaveLength(0);
    const events = parser.feed("ing… (5s · 1k tokens)");
    expect(events).toEqual([
      { kind: "activity", verb: "Reasoning", tokens: 1000, seconds: 5 },
    ]);
  });
});

describe("tuiStatusParser — picker", () => {
  it("emits picker once on absent→present transition with a snippet", () => {
    const parser = createTuiStatusParser(() => 0);
    const events = parser.feed(
      "Do you want to proceed?\n❯ 1. Yes\n  2. No, tell Claude what to do\n",
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("picker");
    expect((events[0] as { snippet: string }).snippet).toContain("1. Yes");
    // Same picker still in window → no re-emit.
    expect(parser.feed("  ")).toHaveLength(0);
  });

  it("re-arms after the picker scrolls out of the window", () => {
    const parser = createTuiStatusParser(() => 0);
    expect(parser.feed("❯ 1. Yes\n 2. No")).toHaveLength(1);
    // Flood the window so the picker text scrolls out (window is 4 KB).
    parser.feed("x".repeat(5000));
    const events = parser.feed("pick again\n❯ 1. Approve\n 2. Deny");
    expect(events.filter((e) => e.kind === "picker")).toHaveLength(1);
  });
});

describe("terminalSequences — ConEmu OSC 9;4 progress", () => {
  it("yields determinate progress with a clamped value", () => {
    const extractor = createTerminalSequenceExtractor();
    expect(extractor.feed("\x1b]9;4;1;42\x07")).toEqual([
      { kind: "progress", state: "normal", value: 42 },
    ]);
    expect(extractor.feed("\x1b]9;4;1;150\x07")).toEqual([
      { kind: "progress", state: "normal", value: 100 },
    ]);
  });

  it("yields remove / indeterminate states without a value", () => {
    const extractor = createTerminalSequenceExtractor();
    expect(extractor.feed("\x1b]9;4;0\x07")).toEqual([
      { kind: "progress", state: "remove" },
    ]);
    expect(extractor.feed("\x1b]9;4;3\x07")).toEqual([
      { kind: "progress", state: "indeterminate" },
    ]);
  });

  it("still treats non-progress OSC 9 payloads as notifications", () => {
    const extractor = createTerminalSequenceExtractor();
    expect(extractor.feed("\x1b]9;tests passed\x07")).toEqual([
      { kind: "notification", body: "tests passed" },
    ]);
    // Malformed progress (unknown state) falls back to notification too.
    expect(extractor.feed("\x1b]9;4;9;50\x07")).toEqual([
      { kind: "notification", body: "4;9;50" },
    ]);
  });
});
