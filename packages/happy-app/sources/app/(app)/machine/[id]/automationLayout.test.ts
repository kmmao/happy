import { describe, expect, it } from "vitest";
import {
    buildAutomationAlerts,
    buildAutomationOverviewCards,
    getRecentJobPreview,
} from "./automationLayout";
import type { MachineAutomationAuditEvent, MachineAutomationJob } from "@/sync/ops";

describe("automationLayout", () => {
    it("prioritizes the four primary overview cards for mobile scanning", () => {
        const cards = buildAutomationOverviewCards({
            counts: {
                queued: 2,
                running: 3,
                dispatching: 1,
            },
            guardianCount: 5,
            alertCount: 4,
        });

        expect(cards).toEqual([
            { kind: "running", value: "4", accent: "#0A84FF" },
            { kind: "queued", value: "2", accent: "#FF9500" },
            { kind: "alerts", value: "4", accent: "#FF3B30" },
            { kind: "guardians", value: "5", accent: undefined },
        ]);
    });

    it("only emits alert banners when actionable signals exist", () => {
        const alerts = buildAutomationAlerts({
            persistedGuardianCount: 2,
            anomalyCount: 3,
            recoveredSessionCount: 1,
        });

        expect(alerts.map((alert: { kind: string }) => alert.kind)).toEqual([
            "anomalies",
            "recovered",
            "guardians",
        ]);
        expect(alerts.map((alert: { count: number }) => alert.count)).toEqual([3, 1, 2]);
    });

    it("limits recent job preview to the newest entries", () => {
        const jobs = [
            { id: "job-1", updatedAt: 100, status: "queued", dedupeKey: "a", createdAt: 100, kind: "supervisor", priority: "user" },
            { id: "job-2", updatedAt: 300, status: "running", dedupeKey: "b", createdAt: 300, kind: "supervisor", priority: "user" },
            { id: "job-3", updatedAt: 200, status: "failed", dedupeKey: "c", createdAt: 200, kind: "supervisor", priority: "user" },
            { id: "job-4", updatedAt: 400, status: "completed", dedupeKey: "d", createdAt: 400, kind: "supervisor", priority: "user" },
        ] as MachineAutomationJob[];

        const preview = getRecentJobPreview(jobs, 3);

        expect(preview.map((job: { id: string }) => job.id)).toEqual(["job-4", "job-2", "job-3"]);
    });

    it("finds related audit events for a previewed job", () => {
        const job = {
            id: "job-1",
            dedupeKey: "dedupe-1",
            sessionId: "session-1",
            runId: "run-1",
            updatedAt: 100,
            createdAt: 100,
            status: "running",
            kind: "supervisor",
            priority: "user",
        } as MachineAutomationJob;
        const events = [
            { id: "a", occurredAt: 100, kind: "job_enqueued", jobId: "job-1" },
            { id: "b", occurredAt: 101, kind: "job_terminal", dedupeKey: "dedupe-1" },
            { id: "c", occurredAt: 102, kind: "guardian_reused", sessionId: "session-1" },
            { id: "d", occurredAt: 103, kind: "job_terminal", runId: "run-1" },
            { id: "e", occurredAt: 104, kind: "guardian_reused", sessionId: "session-x" },
        ] as MachineAutomationAuditEvent[];

        const preview = getRecentJobPreview([job], 1, events);

        expect(preview[0]?.relatedEventCount).toBe(4);
    });

    it("ignores empty alert states", () => {
        expect(
            buildAutomationAlerts({
                persistedGuardianCount: 0,
                anomalyCount: 0,
                recoveredSessionCount: 0,
            }),
        ).toEqual([]);
    });
});
