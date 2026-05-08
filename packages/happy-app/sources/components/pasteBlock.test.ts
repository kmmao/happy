import { describe, expect, it } from "vitest";

import {
  appendPasteBlocksToMessage,
  createPasteBlock,
  shouldCreatePasteBlock,
} from "./pasteBlock";

const labels = {
  fallbackPreview: "Pasted content",
  summary: ({ preview, lines }: { preview: string; lines: number }) =>
    `${preview} · ${lines} ${lines === 1 ? "line" : "lines"}`,
};

describe("pasteBlock", () => {
  it("keeps short paste inline", () => {
    expect(shouldCreatePasteBlock("one\ntwo\nthree")).toBe(false);
  });

  it("creates a block for paste over the line threshold", () => {
    const text = Array.from({ length: 7 }, (_, index) => `line ${index + 1}`).join("\n");
    expect(shouldCreatePasteBlock(text)).toBe(true);
  });

  it("creates a block for paste over the character threshold", () => {
    expect(shouldCreatePasteBlock("x".repeat(801))).toBe(true);
  });

  it("normalizes CRLF and builds a stable summary", () => {
    const block = createPasteBlock("paste-1", "SELECT * FROM sys_log\r\nWHERE id = ?", labels);
    expect(block).toMatchObject({
      id: "paste-1",
      text: "SELECT * FROM sys_log\nWHERE id = ?",
      summary: "SELECT * FROM sys_log · 2 lines",
      lineCount: 2,
      charCount: 34,
    });
  });

  it("appends block contents after visible input text", () => {
    const block = createPasteBlock("paste-1", "large\ncontent", labels);
    expect(appendPasteBlocksToMessage("question", [block])).toBe("question\nlarge\ncontent");
  });

  it("creates a block for multiline pasted content used in the session flow", () => {
    const text = Array.from({ length: 10 }, (_, index) => `row ${index + 1}`).join("\n");
    const block = createPasteBlock("paste-2", text, labels);

    expect(shouldCreatePasteBlock(block.text)).toBe(true);
    expect(block.summary).toContain("10 lines");
  });

  it("builds the final send text by appending paste blocks after the visible prompt", () => {
    const block = createPasteBlock("paste-3", "first\nsecond\nthird", labels);

    expect(appendPasteBlocksToMessage("prompt", [block])).toBe("prompt\nfirst\nsecond\nthird");
  });
});
