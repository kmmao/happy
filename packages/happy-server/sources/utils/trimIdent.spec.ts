import { describe, it, expect } from "vitest";
import { trimIdent } from "./trimIdent";

describe("trimIdent", () => {
    it("should remove common leading whitespace", () => {
        const input = `
            hello
            world
        `;
        expect(trimIdent(input)).toBe("hello\nworld");
    });

    it("should preserve relative indentation", () => {
        const input = `
            parent
                child
            sibling
        `;
        expect(trimIdent(input)).toBe("parent\n    child\nsibling");
    });

    it("should handle single line", () => {
        expect(trimIdent("    hello")).toBe("hello");
    });

    it("should handle no indentation", () => {
        expect(trimIdent("hello\nworld")).toBe("hello\nworld");
    });

    it("should handle empty string", () => {
        expect(trimIdent("")).toBe("");
    });

    it("should handle only whitespace", () => {
        expect(trimIdent("   \n   \n   ")).toBe("");
    });

    it("should skip empty lines when calculating min indent", () => {
        const input = `
            line1

            line2
        `;
        expect(trimIdent(input)).toBe("line1\n\nline2");
    });

    it("should remove leading and trailing empty lines", () => {
        const input = "\n\n    hello\n    world\n\n";
        expect(trimIdent(input)).toBe("hello\nworld");
    });
});
