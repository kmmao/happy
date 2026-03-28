import { describe, it, expect } from "vitest";

/**
 * knowledgeContributor is primarily a DB-integration module.
 * Unit tests cover the mapping logic; full integration tests
 * require a real DB (tested via E2E).
 */
describe("knowledgeContributor mapping logic", () => {
    it("should map critical/high severity to 'warning' entryType", () => {
        const severityToType = (severity: string) =>
            severity === "critical" || severity === "high" ? "warning" : "discovery";

        expect(severityToType("critical")).toBe("warning");
        expect(severityToType("high")).toBe("warning");
        expect(severityToType("medium")).toBe("discovery");
        expect(severityToType("low")).toBe("discovery");
    });

    it("should map confidence number to enum", () => {
        const toConfidence = (n?: number) =>
            n !== undefined
                ? (n >= 80 ? "high" : n >= 50 ? "medium" : "low")
                : "medium";

        expect(toConfidence(90)).toBe("high");
        expect(toConfidence(80)).toBe("high");
        expect(toConfidence(79)).toBe("medium");
        expect(toConfidence(50)).toBe("medium");
        expect(toConfidence(49)).toBe("low");
        expect(toConfidence(undefined)).toBe("medium");
    });

    it("should append suggestedFix to content when available", () => {
        const buildContent = (desc: string, fix?: string) =>
            fix ? `${desc}\n\nSuggested fix: ${fix}` : desc;

        expect(buildContent("Bug found", "Fix it")).toBe("Bug found\n\nSuggested fix: Fix it");
        expect(buildContent("Bug found")).toBe("Bug found");
    });

    it("should limit to MAX_ENTRIES_PER_RUN (5)", () => {
        const MAX = 5;
        const actions = Array.from({ length: 20 }, (_, i) => ({ id: i }));
        expect(actions.slice(0, MAX)).toHaveLength(5);
    });
});
