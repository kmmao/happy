import { describe, expect, it } from "vitest";
import { resolveSessionProviderTone } from "@/utils/sessionProviderTone";

describe("resolveSessionProviderTone", () => {
    it("maps known providers to stable tones", () => {
        expect(resolveSessionProviderTone("claude")).toBe("purple");
        expect(resolveSessionProviderTone("codex")).toBe("blue");
        expect(resolveSessionProviderTone("azure-openai")).toBe("blue");
        expect(resolveSessionProviderTone("gemini")).toBe("orange");
        expect(resolveSessionProviderTone("deepseek")).toBe("teal");
        expect(resolveSessionProviderTone("zai")).toBe("magenta");
        expect(resolveSessionProviderTone("kimi")).toBe("green");
    });

    it("falls back to neutral for unknown providers", () => {
        expect(resolveSessionProviderTone("custom-provider")).toBe("neutral");
        expect(resolveSessionProviderTone("")).toBe("neutral");
        expect(resolveSessionProviderTone(undefined)).toBe("neutral");
    });
});
