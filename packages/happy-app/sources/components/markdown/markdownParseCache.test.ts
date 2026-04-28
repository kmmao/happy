import { describe, expect, it } from "vitest";
import { getCachedMarkdownBlocks } from "./markdownParseCache";

const makeMarkdown = (index: number): string => `# Title ${index}\n\nBody ${index}`;

describe("getCachedMarkdownBlocks", () => {
    it("returns the same parsed blocks for repeated markdown", () => {
        const markdown = "# Cached\n\n- one\n- two";

        const first = getCachedMarkdownBlocks(markdown);
        const second = getCachedMarkdownBlocks(markdown);

        expect(second).toBe(first);
    });

    it("evicts the least recently used markdown when capacity is exceeded", () => {
        const firstMarkdown = makeMarkdown(0);
        const first = getCachedMarkdownBlocks(firstMarkdown);

        for (let i = 1; i <= 150; i += 1) {
            getCachedMarkdownBlocks(makeMarkdown(i));
        }

        const afterEviction = getCachedMarkdownBlocks(firstMarkdown);

        expect(afterEviction).not.toBe(first);
        expect(afterEviction).toEqual(first);
    });

    it("keeps recently used markdown when evicting old entries", () => {
        const firstMarkdown = makeMarkdown(200);
        const first = getCachedMarkdownBlocks(firstMarkdown);

        for (let i = 201; i < 350; i += 1) {
            getCachedMarkdownBlocks(makeMarkdown(i));
        }

        expect(getCachedMarkdownBlocks(firstMarkdown)).toBe(first);
        getCachedMarkdownBlocks(makeMarkdown(350));

        expect(getCachedMarkdownBlocks(firstMarkdown)).toBe(first);
    });
});
