import { describe, expect, it } from "vitest";
import {
    computeHealthScore,
    computeHealthGrade,
    countSeverities,
    computeTrendDirection,
    type SeverityCounts,
} from "./supervisorScoring";

describe("computeHealthScore", () => {
    it("should return 0 for no issues", () => {
        const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
        expect(computeHealthScore(counts)).toBe(0);
    });

    it("should weight critical at 10", () => {
        const counts: SeverityCounts = { critical: 1, high: 0, medium: 0, low: 0 };
        expect(computeHealthScore(counts)).toBe(10);
    });

    it("should weight high at 5", () => {
        const counts: SeverityCounts = { critical: 0, high: 2, medium: 0, low: 0 };
        expect(computeHealthScore(counts)).toBe(10);
    });

    it("should weight medium at 2", () => {
        const counts: SeverityCounts = { critical: 0, high: 0, medium: 3, low: 0 };
        expect(computeHealthScore(counts)).toBe(6);
    });

    it("should weight low at 1", () => {
        const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 5 };
        expect(computeHealthScore(counts)).toBe(5);
    });

    it("should sum all severities", () => {
        const counts: SeverityCounts = { critical: 1, high: 1, medium: 1, low: 1 };
        expect(computeHealthScore(counts)).toBe(10 + 5 + 2 + 1);
    });
});

describe("computeHealthGrade", () => {
    it("should return A for score 0", () => {
        expect(computeHealthGrade(0)).toBe("A");
    });

    it("should return A for score 5", () => {
        expect(computeHealthGrade(5)).toBe("A");
    });

    it("should return B for score 6", () => {
        expect(computeHealthGrade(6)).toBe("B");
    });

    it("should return B for score 15", () => {
        expect(computeHealthGrade(15)).toBe("B");
    });

    it("should return C for score 16", () => {
        expect(computeHealthGrade(16)).toBe("C");
    });

    it("should return C for score 30", () => {
        expect(computeHealthGrade(30)).toBe("C");
    });

    it("should return D for score 31", () => {
        expect(computeHealthGrade(31)).toBe("D");
    });

    it("should return D for score 50", () => {
        expect(computeHealthGrade(50)).toBe("D");
    });

    it("should return F for score 51", () => {
        expect(computeHealthGrade(51)).toBe("F");
    });

    it("should return F for very high score", () => {
        expect(computeHealthGrade(200)).toBe("F");
    });
});

describe("countSeverities", () => {
    it("should return zero counts for empty array", () => {
        expect(countSeverities([])).toEqual({
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
        });
    });

    it("should count each severity correctly", () => {
        const actions = [
            { severity: "critical" },
            { severity: "high" },
            { severity: "high" },
            { severity: "medium" },
            { severity: "low" },
            { severity: "low" },
            { severity: "low" },
        ];
        expect(countSeverities(actions)).toEqual({
            critical: 1,
            high: 2,
            medium: 1,
            low: 3,
        });
    });

    it("should ignore unknown severity values", () => {
        const actions = [
            { severity: "critical" },
            { severity: "unknown" },
            { severity: "info" },
        ];
        expect(countSeverities(actions)).toEqual({
            critical: 1,
            high: 0,
            medium: 0,
            low: 0,
        });
    });
});

describe("computeTrendDirection", () => {
    it("should return improving when current < previous", () => {
        expect(computeTrendDirection(3, 5)).toBe("improving");
    });

    it("should return declining when current > previous", () => {
        expect(computeTrendDirection(8, 3)).toBe("declining");
    });

    it("should return stable when counts are equal", () => {
        expect(computeTrendDirection(5, 5)).toBe("stable");
    });

    it("should return improving for 0 vs positive", () => {
        expect(computeTrendDirection(0, 10)).toBe("improving");
    });

    it("should return stable for both zero", () => {
        expect(computeTrendDirection(0, 0)).toBe("stable");
    });
});
