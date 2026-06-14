/**
 * Unit tests for RemoteAgentLoopController.
 *
 * Uses fake scheduler + http client so we exercise the controller's
 * own bookkeeping without touching disk or the network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    RemoteAgentLoopController,
    type RemoteAgentLoopSchedulerLike,
    type RemoteAgentLoopHttpClient,
    type RemoteAgentLoopLogger,
} from "./RemoteAgentLoopController";
import type { AgentLoopTriggerEphemeral } from "@kmmao/happy-wire";
import type { AutomationJob } from "./types";

function makeEphemeral(
    over: Partial<AgentLoopTriggerEphemeral> = {},
): AgentLoopTriggerEphemeral {
    return {
        t: "agent-loop-trigger",
        loopId: "loop-1",
        projectId: "proj-1",
        machineId: "machine-1",
        iteration: 0,
        prompt: "do the thing",
        directory: "/tmp/proj",
        agent: "claude",
        callbackToken: "test-token-aaaa",
        ...over,
    };
}

function makeJob(over: Partial<AutomationJob> = {}): AutomationJob {
    return {
        id: "job-1",
        kind: "agent_loop",
        status: "queued",
        priority: "background",
        dedupeKey: "agent-loop:loop-1:0",
        attempt: 0,
        maxAttempts: 3,
        createdAt: 1,
        updatedAt: 1,
        payload: {
            type: "agent-loop-trigger",
            loopId: "loop-1",
            prompt: "do the thing",
            directory: "/tmp/proj",
            intervalMs: 0,
            trigger: "schedule",
            iteration: 0,
        },
        ...over,
    } as AutomationJob;
}

function makeFakeScheduler(): RemoteAgentLoopSchedulerLike & {
    calls: Array<unknown>;
} {
    const calls: Array<unknown> = [];
    return {
        calls,
        async enqueueAgentLoop(data) {
            calls.push(data);
            return { job: makeJob(), deduped: false };
        },
    };
}

function makeFakeHttp(): RemoteAgentLoopHttpClient & {
    calls: Array<{ projectId: string; loopId: string; bearerToken: string; body: unknown }>;
    nextResponse: { ok: boolean; error?: string };
} {
    return {
        calls: [],
        nextResponse: { ok: true },
        async postAgentLoopIterationReport(opts) {
            this.calls.push(opts);
            return this.nextResponse;
        },
    };
}

const silentLogger: RemoteAgentLoopLogger = {};

describe("RemoteAgentLoopController.handleTriggerEphemeral", () => {
    let scheduler: ReturnType<typeof makeFakeScheduler>;
    let http: ReturnType<typeof makeFakeHttp>;
    let controller: RemoteAgentLoopController;

    beforeEach(() => {
        scheduler = makeFakeScheduler();
        http = makeFakeHttp();
        controller = new RemoteAgentLoopController({
            scheduler,
            httpClient: http,
            logger: silentLogger,
        });
    });

    it("enqueues a translated AgentLoopTriggerData payload", async () => {
        const result = await controller.handleTriggerEphemeral(
            makeEphemeral({ iteration: 5 }),
        );

        expect(scheduler.calls).toHaveLength(1);
        expect(scheduler.calls[0]).toMatchObject({
            type: "agent-loop-trigger",
            loopId: "loop-1",
            iteration: 5,
            intervalMs: 0,
            trigger: "schedule",
            agent: "claude",
            projectId: "proj-1",
        });
        expect(result.job.id).toBe("job-1");
    });

    it("tracks the job so a later terminal can post back", async () => {
        await controller.handleTriggerEphemeral(makeEphemeral());
        expect(controller.trackedCount()).toBe(1);
    });

    it("promotes well-known scalars from genericConfig", async () => {
        await controller.handleTriggerEphemeral(
            makeEphemeral({
                genericConfig: {
                    goal: "ship it",
                    cooldownMs: 5000,
                    environmentVariables: { FOO: "bar" },
                    // unknown keys are dropped on purpose
                    nonsense: "x",
                },
            }),
        );

        const sentToScheduler = scheduler.calls[0] as Record<string, unknown>;
        expect(sentToScheduler.goal).toBe("ship it");
        expect(sentToScheduler.cooldownMs).toBe(5000);
        expect(sentToScheduler.environmentVariables).toEqual({ FOO: "bar" });
        expect(sentToScheduler).not.toHaveProperty("nonsense");
    });
});

describe("RemoteAgentLoopController.handleJobTerminal", () => {
    let scheduler: ReturnType<typeof makeFakeScheduler>;
    let http: ReturnType<typeof makeFakeHttp>;
    let controller: RemoteAgentLoopController;

    beforeEach(() => {
        scheduler = makeFakeScheduler();
        http = makeFakeHttp();
        controller = new RemoteAgentLoopController({
            scheduler,
            httpClient: http,
            logger: silentLogger,
        });
    });

    it("posts an iteration report for a tracked job", async () => {
        await controller.handleTriggerEphemeral(makeEphemeral({ iteration: 7 }));
        await controller.handleJobTerminal({
            jobId: "job-1",
            status: "completed",
            sessionId: "sess-1",
            briefSummary: "all green",
            costUsd: 0.42,
            tokens: 12000,
        });

        expect(http.calls).toHaveLength(1);
        expect(http.calls[0]).toMatchObject({
            projectId: "proj-1",
            loopId: "loop-1",
            bearerToken: "test-token-aaaa",
        });
        expect(http.calls[0].body).toMatchObject({
            iteration: 7,
            sessionId: "sess-1",
            status: "completed",
            briefSummary: "all green",
            costUsd: 0.42,
            tokens: 12000,
        });

        // Tracker entry should be cleared after firing.
        expect(controller.trackedCount()).toBe(0);
    });

    it("ignores terminal events for jobs it never tracked", async () => {
        await controller.handleJobTerminal({
            jobId: "unknown-job",
            status: "completed",
            sessionId: "sess-x",
        });
        expect(http.calls).toHaveLength(0);
    });

    it("does not throw when http client rejects", async () => {
        http.postAgentLoopIterationReport = vi.fn().mockRejectedValue(new Error("network"));
        await controller.handleTriggerEphemeral(makeEphemeral());
        await expect(
            controller.handleJobTerminal({
                jobId: "job-1",
                status: "failed",
                errorMessage: "blew up",
            }),
        ).resolves.toBeUndefined();
        expect(controller.trackedCount()).toBe(0);
    });

    it("does not throw when http client returns ok=false", async () => {
        http.nextResponse = { ok: false, error: "401" };
        await controller.handleTriggerEphemeral(makeEphemeral());
        await expect(
            controller.handleJobTerminal({
                jobId: "job-1",
                status: "completed",
            }),
        ).resolves.toBeUndefined();
    });
});

describe("RemoteAgentLoopController stale eviction", () => {
    it("drops tracker entries older than maxAgeMs on next enqueue", async () => {
        const scheduler = makeFakeScheduler();
        const http = makeFakeHttp();
        const controller = new RemoteAgentLoopController({
            scheduler,
            httpClient: http,
            logger: silentLogger,
            maxAgeMs: 5, // 5ms — easy to age out
        });

        await controller.handleTriggerEphemeral(makeEphemeral({ loopId: "loop-old" }));
        expect(controller.trackedCount()).toBe(1);

        // Wait past the eviction window.
        await new Promise((r) => setTimeout(r, 20));

        // The second trigger increments the scheduler's internal job id
        // counter only conceptually — here we make the scheduler return a
        // distinct job id so the new entry isn't merged with the old.
        scheduler.enqueueAgentLoop = async (data) => {
            scheduler.calls.push(data);
            return { job: makeJob({ id: "job-2" }), deduped: false };
        };

        await controller.handleTriggerEphemeral(makeEphemeral({ loopId: "loop-new" }));
        expect(controller.trackedCount()).toBe(1); // old one evicted, only new remains
    });
});
