import { describe, expect, it } from "vitest";
import { computeScheduledRunRecoveryWindow } from "./supervisorScheduler";

describe("computeScheduledRunRecoveryWindow", () => {
    it("keeps future schedules unchanged", () => {
        const now = new Date("2025-01-01T12:00:00.000Z");
        const nextRunAt = new Date("2025-01-01T13:00:00.000Z");
        const result = computeScheduledRunRecoveryWindow({
            nextRunAt,
            intervalHours: 1,
            now,
        });

        expect(result.due).toBe(false);
        expect(result.nextRunAt?.toISOString()).toBe(nextRunAt.toISOString());
        expect(result.missedRuns).toBe(0);
    });

    it("advances to the next cadence slot and counts missed runs", () => {
        const now = new Date("2025-01-01T12:35:00.000Z");
        const nextRunAt = new Date("2025-01-01T10:00:00.000Z");
        const result = computeScheduledRunRecoveryWindow({
            nextRunAt,
            intervalHours: 1,
            now,
        });

        expect(result.due).toBe(true);
        expect(result.totalDueRuns).toBe(3);
        expect(result.missedRuns).toBe(2);
        expect(result.nextRunAt?.toISOString()).toBe("2025-01-01T13:00:00.000Z");
    });

    it("defaults to a 24h cadence", () => {
        const now = new Date("2025-01-03T00:00:00.000Z");
        const nextRunAt = new Date("2025-01-01T00:00:00.000Z");
        const result = computeScheduledRunRecoveryWindow({
            nextRunAt,
            intervalHours: null,
            now,
        });

        expect(result.intervalHours).toBe(24);
        expect(result.missedRuns).toBe(2);
        expect(result.nextRunAt?.toISOString()).toBe("2025-01-04T00:00:00.000Z");
    });
});
