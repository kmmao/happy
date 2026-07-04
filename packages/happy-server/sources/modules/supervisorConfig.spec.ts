import { describe, it, expect } from "vitest";
import {
    parseSupervisorConfig,
    resolveAutoApproveSeverities,
    parseAutoApproveSeverities,
    parseEnabledDimensions,
} from "./supervisorConfig";

describe("parseSupervisorConfig", () => {
    it("returns fully-defaulted config for null / empty / malformed input", () => {
        const expected = {
            autoApprove: { autoSeverities: null, semiAutoSeverities: null },
            concurrency: { maxAnalysisSessions: undefined, maxFixSessions: undefined },
            maxFindings: undefined,
            defaultProfileId: null,
            analyzeAutoFix: false,
        };
        expect(parseSupervisorConfig(null)).toEqual(expected);
        expect(parseSupervisorConfig(undefined)).toEqual(expected);
        expect(parseSupervisorConfig("")).toEqual(expected);
        expect(parseSupervisorConfig("{not json")).toEqual(expected);
        expect(parseSupervisorConfig("42")).toEqual(expected);
        expect(parseSupervisorConfig("null")).toEqual(expected);
    });

    it("extracts concurrency only when numeric", () => {
        expect(
            parseSupervisorConfig(
                JSON.stringify({ concurrency: { maxAnalysisSessions: 3, maxFixSessions: 2 } }),
            ).concurrency,
        ).toEqual({ maxAnalysisSessions: 3, maxFixSessions: 2 });
        // non-numeric / missing → undefined
        expect(
            parseSupervisorConfig(
                JSON.stringify({ concurrency: { maxAnalysisSessions: "5" } }),
            ).concurrency,
        ).toEqual({ maxAnalysisSessions: undefined, maxFixSessions: undefined });
        // concurrency not an object → both undefined
        expect(
            parseSupervisorConfig(JSON.stringify({ concurrency: 7 })).concurrency,
        ).toEqual({ maxAnalysisSessions: undefined, maxFixSessions: undefined });
    });

    it("extracts maxFindings, defaultProfileId, analyzeAutoFix", () => {
        const cfg = parseSupervisorConfig(
            JSON.stringify({
                maxFindings: 12,
                defaultProfileId: "prof-1",
                analyzeAutoFix: true,
            }),
        );
        expect(cfg.maxFindings).toBe(12);
        expect(cfg.defaultProfileId).toBe("prof-1");
        expect(cfg.analyzeAutoFix).toBe(true);
    });

    it("analyzeAutoFix is strictly `=== true`", () => {
        expect(parseSupervisorConfig(JSON.stringify({ analyzeAutoFix: "true" })).analyzeAutoFix).toBe(false);
        expect(parseSupervisorConfig(JSON.stringify({ analyzeAutoFix: 1 })).analyzeAutoFix).toBe(false);
    });

    it("distinguishes unconfigured (null) from configured-all-invalid ([]) severities", () => {
        // unconfigured → null → resolves to defaults
        expect(parseSupervisorConfig("{}").autoApprove.autoSeverities).toBeNull();
        // empty array → treated as unconfigured → null
        expect(
            parseSupervisorConfig(JSON.stringify({ autoApprove: { autoSeverities: [] } })).autoApprove.autoSeverities,
        ).toBeNull();
        // configured but all invalid → [] (explicitly approve nothing), NOT null
        expect(
            parseSupervisorConfig(
                JSON.stringify({ autoApprove: { autoSeverities: ["bogus", 5] } }),
            ).autoApprove.autoSeverities,
        ).toEqual([]);
        // configured mixed → valid subset
        expect(
            parseSupervisorConfig(
                JSON.stringify({ autoApprove: { autoSeverities: ["high", "nope", "critical"] } }),
            ).autoApprove.autoSeverities,
        ).toEqual(["high", "critical"]);
    });
});

describe("resolveAutoApproveSeverities", () => {
    it("applies mode defaults only when unconfigured", () => {
        const empty = parseSupervisorConfig(null);
        expect(resolveAutoApproveSeverities(empty, "auto")).toEqual(["low", "medium", "high", "critical"]);
        expect(resolveAutoApproveSeverities(empty, "semi-auto")).toEqual(["low", "medium"]);
    });

    it("configured-all-invalid resolves to [] (not defaults)", () => {
        const cfg = parseSupervisorConfig(
            JSON.stringify({ autoApprove: { autoSeverities: ["bogus"], semiAutoSeverities: ["nope"] } }),
        );
        expect(resolveAutoApproveSeverities(cfg, "auto")).toEqual([]);
        expect(resolveAutoApproveSeverities(cfg, "semi-auto")).toEqual([]);
    });
});

describe("parseAutoApproveSeverities (back-compat)", () => {
    it("matches the pre-refactor behavior end to end", () => {
        expect(parseAutoApproveSeverities(null, "auto")).toEqual(["low", "medium", "high", "critical"]);
        expect(parseAutoApproveSeverities(null, "semi-auto")).toEqual(["low", "medium"]);
        expect(
            parseAutoApproveSeverities(JSON.stringify({ autoApprove: { autoSeverities: ["high"] } }), "auto"),
        ).toEqual(["high"]);
    });
});

describe("parseEnabledDimensions", () => {
    it("splits, trims, and drops empties; undefined when nothing configured", () => {
        expect(parseEnabledDimensions(null)).toBeUndefined();
        expect(parseEnabledDimensions("")).toBeUndefined();
        expect(parseEnabledDimensions("  ,  ")).toBeUndefined();
        expect(parseEnabledDimensions("security, , architecture ")).toEqual(["security", "architecture"]);
    });
});
