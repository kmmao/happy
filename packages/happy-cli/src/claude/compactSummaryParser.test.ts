import { describe, it, expect } from "vitest";
import { extractCompactSummary } from "./compactSummaryParser";

// Verbose because the parser sits on the load-bearing path from
// `compact_boundary` to the App's "Compaction summary" bubble. Each case
// pins a specific shape we've observed in real session.jsonl files
// produced by Claude Code 2.1.x (PTY/TUI) and the prior SDK era.
describe("extractCompactSummary", () => {
  // The canonical shape captured from PID 91031's session JSONL (see
  // 286b77e0-…jsonl line 846 in the bug-investigation transcript): a user
  // record with `isCompactSummary:true` whose content is a plain string.
  it("extracts the PTY user-record summary (string content)", () => {
    const boundaryUuid = "boundary-aaa";
    const jsonl =
      JSON.stringify({
        type: "system",
        subtype: "compact_boundary",
        uuid: boundaryUuid,
      }) +
      "\n" +
      JSON.stringify({
        type: "user",
        parentUuid: boundaryUuid,
        isCompactSummary: true,
        message: { role: "user", content: "Summary body line 1\nline 2" },
      });
    expect(extractCompactSummary(jsonl, boundaryUuid)).toBe(
      "Summary body line 1\nline 2",
    );
  });

  // Claude historically also writes summaries as a content-block array;
  // we should flatten text blocks and skip non-text (image, tool_use, …).
  it("flattens array content, skipping non-text blocks", () => {
    const jsonl = JSON.stringify({
      type: "user",
      parentUuid: "b1",
      isCompactSummary: true,
      message: {
        role: "user",
        content: [
          { type: "text", text: "Alpha " },
          { type: "image", source: { url: "x" } },
          { type: "text", text: "Beta" },
        ],
      },
    });
    expect(extractCompactSummary(jsonl, "b1")).toBe("Alpha Beta");
  });

  // When `boundaryUuid` matches one of several `isCompactSummary` records,
  // the matched one wins over the file-order latest. This is what makes
  // back-to-back `/compact` runs disambiguate correctly.
  it("prefers the parentUuid match over the latest record", () => {
    const olderBoundary = "boundary-older";
    const newerBoundary = "boundary-newer";
    const jsonl =
      JSON.stringify({
        type: "user",
        parentUuid: olderBoundary,
        isCompactSummary: true,
        message: { content: "old summary" },
      }) +
      "\n" +
      JSON.stringify({
        type: "user",
        parentUuid: newerBoundary,
        isCompactSummary: true,
        message: { content: "new summary" },
      });
    // Without a uuid: latest wins (RPC / fork-copy semantics).
    expect(extractCompactSummary(jsonl)).toBe("new summary");
    // With a uuid: precise tie wins, even when the matching record is older.
    expect(extractCompactSummary(jsonl, olderBoundary)).toBe("old summary");
    expect(extractCompactSummary(jsonl, newerBoundary)).toBe("new summary");
  });

  // SDK-era `type:"summary"` records still appear in some historical
  // JSONL files. Our reader should recognise both shapes so a fork created
  // from an SDK-mode session still surfaces its summary.
  it("falls back to legacy SDK `type:summary` record", () => {
    const jsonl = JSON.stringify({
      type: "summary",
      summary: "Legacy SDK summary text",
      leafUuid: "x",
    });
    expect(extractCompactSummary(jsonl)).toBe("Legacy SDK summary text");
  });

  // Edge cases that must NOT trip the parser:
  //   1. truncated last line (in-flight write) — the JSON.parse failure is
  //      swallowed so prior records still resolve.
  //   2. empty `message.content` — should not produce a blank bubble.
  //   3. whitespace-only summary — coerced to null after trim.
  it("survives a truncated last line and ignores blank summaries", () => {
    const truncatedTail = '{"type":"user","isCompactSummary":true,"messa';
    const jsonl =
      JSON.stringify({
        type: "user",
        parentUuid: "b1",
        isCompactSummary: true,
        message: { content: "real summary" },
      }) +
      "\n" +
      JSON.stringify({
        type: "user",
        parentUuid: "b2",
        isCompactSummary: true,
        message: { content: "   " }, // whitespace only — should not override
      }) +
      "\n" +
      truncatedTail;
    expect(extractCompactSummary(jsonl)).toBe("real summary");
  });

  // No compact-related records at all → null. The caller uses this to
  // decide whether to emit a structured event without a summary or to
  // keep polling.
  it("returns null when no summary records are present", () => {
    const jsonl =
      JSON.stringify({ type: "user", message: { content: "user prompt" } }) +
      "\n" +
      JSON.stringify({ type: "assistant", message: { content: "agent reply" } });
    expect(extractCompactSummary(jsonl)).toBeNull();
    expect(extractCompactSummary(jsonl, "boundary-xyz")).toBeNull();
  });

  // A `parentUuid` that doesn't match any record falls back to the latest
  // summary (don't return null just because the precise tie failed — the
  // user still wants SOMETHING to look at).
  it("falls back to latest when boundaryUuid matches nothing", () => {
    const jsonl = JSON.stringify({
      type: "user",
      parentUuid: "boundary-other",
      isCompactSummary: true,
      message: { content: "fallback text" },
    });
    expect(extractCompactSummary(jsonl, "boundary-unrelated")).toBe(
      "fallback text",
    );
  });

  // Empty input → null.
  it("returns null on empty input", () => {
    expect(extractCompactSummary("")).toBeNull();
    expect(extractCompactSummary("\n\n\n")).toBeNull();
  });
});
