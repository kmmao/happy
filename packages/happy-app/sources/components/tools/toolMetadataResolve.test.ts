import { describe, it, expect } from "vitest";
import {
    resolveToolTitle,
    resolveToolChildTitle,
    resolveToolSubtitle,
    type ToolTitleSource,
} from "./toolMetadataResolve";
import type { ToolCall } from "@/sync/typesMessage";

const tool = { name: "Bash", input: { command: "ls" } } as unknown as ToolCall;
const metadata = null;

describe("resolveToolTitle", () => {
    it("falls back to the raw tool name when there is no known entry", () => {
        expect(resolveToolTitle(undefined, tool, metadata)).toBe("Bash");
        expect(resolveToolTitle(null, tool, metadata)).toBe("Bash");
        expect(resolveToolTitle({}, tool, metadata)).toBe("Bash");
    });

    it("returns a static string title", () => {
        const known: ToolTitleSource = { title: "Run Command" };
        expect(resolveToolTitle(known, tool, metadata)).toBe("Run Command");
    });

    it("calls a function title with the tool + metadata", () => {
        const known: ToolTitleSource = {
            title: ({ tool }) => `title:${tool.name}`,
        };
        expect(resolveToolTitle(known, tool, metadata)).toBe("title:Bash");
    });
});

describe("resolveToolChildTitle", () => {
    it("prefers extractDescription over title", () => {
        const known: ToolTitleSource = {
            title: "static",
            extractDescription: ({ tool }) => `desc:${tool.name}`,
        };
        expect(resolveToolChildTitle(known, tool, metadata)).toBe("desc:Bash");
    });

    it("falls back to the header title when there is no extractDescription", () => {
        const known: ToolTitleSource = { title: "static" };
        expect(resolveToolChildTitle(known, tool, metadata)).toBe("static");
    });

    it("falls back to the tool name when the entry is empty", () => {
        expect(resolveToolChildTitle({}, tool, metadata)).toBe("Bash");
        expect(resolveToolChildTitle(undefined, tool, metadata)).toBe("Bash");
    });
});

describe("resolveToolSubtitle", () => {
    it("returns null when there is no extractSubtitle", () => {
        expect(resolveToolSubtitle({}, tool, metadata)).toBeNull();
        expect(resolveToolSubtitle(undefined, tool, metadata)).toBeNull();
    });

    it("returns the extracted subtitle when it is a non-empty string", () => {
        const known: ToolTitleSource = {
            extractSubtitle: () => "the subtitle",
        };
        expect(resolveToolSubtitle(known, tool, metadata)).toBe("the subtitle");
    });

    it("returns null when extractSubtitle yields empty / non-string", () => {
        expect(
            resolveToolSubtitle({ extractSubtitle: () => "" }, tool, metadata),
        ).toBeNull();
        expect(
            resolveToolSubtitle({ extractSubtitle: () => null }, tool, metadata),
        ).toBeNull();
        expect(
            resolveToolSubtitle(
                { extractSubtitle: () => undefined },
                tool,
                metadata,
            ),
        ).toBeNull();
    });
});
