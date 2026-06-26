import { describe, it, expect } from "vitest";
import { parseMarkdownBlock } from "./parseMarkdownBlock";

// Narrow helper: find the first block of a given type.
const firstOfType = (blocks: any[], type: string) => blocks.find((b) => b.type === type);

describe("parseMarkdownBlock — headers / code / math / rule", () => {
  it("parses ATX headers at each level", () => {
    const blocks = parseMarkdownBlock("# H1\n### H3");
    expect(blocks[0]).toMatchObject({ type: "header", level: 1 });
    expect(blocks[1]).toMatchObject({ type: "header", level: 3 });
  });

  it("routes a mermaid fenced block to the mermaid type, others to code-block", () => {
    const mermaid = parseMarkdownBlock("```mermaid\ngraph TD\n```");
    expect(mermaid[0]).toMatchObject({ type: "mermaid", content: "graph TD" });
    const code = parseMarkdownBlock("```ts\nconst a = 1;\n```");
    expect(code[0]).toMatchObject({ type: "code-block", language: "ts", content: "const a = 1;" });
  });

  it("parses single-line and multi-line math blocks", () => {
    expect(parseMarkdownBlock("$$ x^2 $$")[0]).toMatchObject({ type: "math-block", content: "x^2" });
    const multi = parseMarkdownBlock("$$\na + b\n$$");
    expect(multi[0]).toMatchObject({ type: "math-block", content: "a + b" });
  });

  it("treats a bare --- as a horizontal rule, not a header", () => {
    expect(parseMarkdownBlock("---")[0]).toMatchObject({ type: "horizontal-rule" });
  });
});

describe("parseMarkdownBlock — lists", () => {
  it("parses a numbered list preserving each item's number", () => {
    const blocks = parseMarkdownBlock("1. first\n2. second");
    const list = firstOfType(blocks, "numbered-list");
    expect(list.items.map((i: any) => i.number)).toEqual([1, 2]);
  });

  it("parses task-list checkboxes as checked/unchecked", () => {
    const blocks = parseMarkdownBlock("- [ ] todo\n- [x] done\n- plain");
    const list = firstOfType(blocks, "list");
    expect(list.items[0].checked).toBe(false);
    expect(list.items[1].checked).toBe(true);
    expect(list.items[2].checked).toBeUndefined();
  });
});

describe("parseMarkdownBlock — table (the bug-prone parseTable)", () => {
  it("parses a leading/trailing-pipe table, stripping empty edge cells", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const table = firstOfType(parseMarkdownBlock(md), "table");
    expect(table.headers).toEqual(["A", "B"]);
    expect(table.rows).toEqual([["1", "2"]]);
  });

  it("skips blank lines between rows rather than terminating the table (PR #730)", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| 3 | 4 |";
    const table = firstOfType(parseMarkdownBlock(md), "table");
    expect(table.rows).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("stops the table at a following non-pipe paragraph (does not swallow it)", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |\ntrailing paragraph";
    const blocks = parseMarkdownBlock(md);
    expect(firstOfType(blocks, "table").rows).toEqual([["1", "2"]]);
    expect(firstOfType(blocks, "text")).toBeDefined();
  });

  it("rejects a pipe line whose second line is not a dashed separator (treats as text)", () => {
    const md = "a | b\nc | d";
    const blocks = parseMarkdownBlock(md);
    expect(firstOfType(blocks, "table")).toBeUndefined();
    expect(firstOfType(blocks, "text")).toBeDefined();
  });

  it("needs at least two pipe lines to be a table", () => {
    const blocks = parseMarkdownBlock("just | one pipe line");
    expect(firstOfType(blocks, "table")).toBeUndefined();
  });
});

describe("parseMarkdownBlock — blockquote / options", () => {
  it("joins consecutive blockquote lines into one block", () => {
    const bq = firstOfType(parseMarkdownBlock("> line one\n> line two"), "blockquote");
    expect(bq).toBeDefined();
  });

  it("extracts <option> items from an options block", () => {
    const md = "<options>\n<option>Yes</option>\n<option>No</option>\n</options>";
    const opts = firstOfType(parseMarkdownBlock(md), "options");
    expect(opts.items).toEqual(["Yes", "No"]);
  });
});
