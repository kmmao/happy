/**
 * Thin socket adapter for supervisor-run-status events from CLI daemons.
 *
 * Validates the daemon's payload and delegates the entire completion flow to
 * `supervisorRunStatusApply` — the deep module shared with the curl HTTP
 * callback. The daemon socket is already authenticated as its machine by the
 * connection, so it passes `enforceMachineMatch: false`; the module's
 * structured rejection outcomes are mapped to debug logs (a socket event has
 * no reply to send).
 */

import { Socket } from "socket.io";
import { z } from "zod";
import { log } from "@/utils/log";
import { supervisorRunStatusApply } from "@/app/api/supervisor/supervisorRunStatusApply";

const supervisorActionSchema = z.object({
    severity: z.enum(["critical", "high", "medium", "low"]),
    category: z.string().max(50),
    title: z.string().max(500),
    description: z.string().max(2000),
    suggestedFix: z.string().max(2000).optional(),
    confidence: z.number().int().min(0).max(100).optional(),
});

const supervisorRunStatusSchema = z.object({
    runId: z.string().min(1),
    projectId: z.string().min(1),
    status: z.enum(["running", "completed", "failed"]),
    sessionId: z.string().min(1).optional(),
    actionsCount: z.number().int().min(0).optional(),
    issuesCreated: z.number().int().min(0).optional(),
    errorMessage: z.string().max(500).optional(),
    actions: z.array(supervisorActionSchema).max(20).optional(),
    tokenCount: z.number().int().min(0).optional(),
    costUsd: z.number().min(0).optional(),
    currentDimension: z.string().max(50).optional(),
    dimensionIndex: z.number().int().min(1).optional(),
    totalDimensions: z.number().int().min(1).optional(),
});

export function supervisorRunStatusHandler(
    socket: Socket,
    userId: string,
): void {
    socket.on("supervisor-run-status", async (rawData: unknown) => {
        try {
            const parsed = supervisorRunStatusSchema.safeParse(rawData);
            if (!parsed.success) {
                log(
                    { module: "supervisor", level: "warn" },
                    `supervisor-run-status: invalid data: ${parsed.error.message}`,
                );
                return;
            }
            const data = parsed.data;

            const result = await supervisorRunStatusApply({
                userId,
                // The daemon socket is authenticated as its machine by the
                // connection, so the machine-ownership check is not enforced.
                machineId: null,
                enforceMachineMatch: false,
                projectId: data.projectId,
                runId: data.runId,
                status: data.status,
                sessionId: data.sessionId,
                actionsCount: data.actionsCount,
                issuesCreated: data.issuesCreated,
                errorMessage: data.errorMessage,
                tokenCount: data.tokenCount,
                costUsd: data.costUsd,
                currentDimension: data.currentDimension,
                dimensionIndex: data.dimensionIndex,
                totalDimensions: data.totalDimensions,
                actions: data.actions,
            });

            if (!result.ok) {
                log(
                    { module: "supervisor", level: "warn" },
                    `supervisor-run-status: run ${data.runId} rejected (${result.status}): ${result.error}`,
                );
                return;
            }

            log(
                { module: "supervisor" },
                `supervisor-run-status: run ${data.runId} → ${data.status}${data.actions ? ` (${data.actions.length} actions)` : ""}`,
            );
        } catch (error) {
            log(
                { module: "supervisor", level: "error" },
                `supervisor-run-status handler error: ${error}`,
            );
        }
    });
}
