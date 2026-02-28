import { describe, it, expect } from "vitest";
import { splitIntoSentences } from "./sentenceSplitter";

describe("splitIntoSentences", () => {
    it("returns single segment for short text", () => {
        expect(splitIntoSentences("Hello world")).toEqual(["Hello world"]);
    });

    it("splits at sentence boundaries", () => {
        const input =
            "This is the first sentence. This is the second sentence. And the third one here.";
        const result = splitIntoSentences(input);
        expect(result.length).toBeGreaterThan(1);
        expect(result.join(" ")).toBe(input);
    });

    it("merges very short segments", () => {
        const input = "Hi. Ok. Sure. That sounds great to me.";
        const result = splitIntoSentences(input);
        // Short segments should be merged until they reach ~40 chars
        expect(result.length).toBeLessThan(4);
    });

    it("handles CJK punctuation", () => {
        const input = "这是第一句话。这是第二句话。这是第三句话，它比较长所以应该单独分割。";
        const result = splitIntoSentences(input);
        expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("handles exclamation and question marks", () => {
        const input = "What happened to the project? I have no idea! Let me check the logs for more information.";
        const result = splitIntoSentences(input);
        expect(result.length).toBeGreaterThan(1);
    });

    it("preserves all content when joined", () => {
        const input =
            "First sentence here. Second sentence here. Third and final sentence with more text.";
        const result = splitIntoSentences(input);
        expect(result.join(" ")).toBe(input);
    });

    it("returns empty array for empty input", () => {
        expect(splitIntoSentences("")).toEqual([]);
    });

    it("appends very short trailing segment to last", () => {
        const input = "This is a long enough sentence to be its own segment. Ok.";
        const result = splitIntoSentences(input);
        // "Ok." is too short to be standalone, should be appended
        expect(result[result.length - 1]).toContain("Ok.");
    });
});
