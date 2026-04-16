import { describe, expect, it } from "vitest";

import { Message } from "@/sync/typesMessage";
import {
  buildSessionTimingDiagnosticsExport,
  buildSessionTimingDiagnosticsReport,
} from "./sessionTimingDiagnostics";

function readyMessage(input: {
  id: string;
  createdAt: number;
  model?: string;
  provider?: string;
  requestIds?: string[];
  socketToQueueMs?: number;
  queueWaitMs?: number;
  firstOutputMs?: number;
  firstTextMs?: number;
  postFirstOutputMs?: number;
  postFirstTextMs?: number;
  turnDurationMs?: number;
}): Message {
  return {
    kind: "agent-event",
    id: input.id,
    createdAt: input.createdAt,
    event: {
      type: "ready",
      ...(input.model ? { model: input.model } : {}),
      diagnostics: {
        version: 1,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.requestIds ? { requestIds: input.requestIds } : {}),
        ...(input.socketToQueueMs !== undefined
          ? { socketToQueueMs: input.socketToQueueMs }
          : {}),
        ...(input.queueWaitMs !== undefined
          ? { queueWaitMs: input.queueWaitMs }
          : {}),
        ...(input.firstOutputMs !== undefined
          ? { firstOutputMs: input.firstOutputMs }
          : {}),
        ...(input.firstTextMs !== undefined
          ? { firstTextMs: input.firstTextMs }
          : {}),
        ...(input.postFirstOutputMs !== undefined
          ? { postFirstOutputMs: input.postFirstOutputMs }
          : {}),
        ...(input.postFirstTextMs !== undefined
          ? { postFirstTextMs: input.postFirstTextMs }
          : {}),
        ...(input.turnDurationMs !== undefined
          ? { turnDurationMs: input.turnDurationMs }
          : {}),
      },
    },
  };
}

describe("buildSessionTimingDiagnosticsReport", () => {
  it("returns null when there are no ready diagnostics", () => {
    const report = buildSessionTimingDiagnosticsReport([
      {
        kind: "agent-text",
        id: "text-1",
        localId: null,
        createdAt: 100,
        text: "hello",
      },
    ]);

    expect(report).toBeNull();
  });

  it("aggregates recent turns and summary metrics", () => {
    const report = buildSessionTimingDiagnosticsReport([
      readyMessage({
        id: "turn-1",
        createdAt: 1_000,
        model: "claude-sonnet-4",
        provider: "claude",
        requestIds: ["req-1"],
        socketToQueueMs: 40,
        queueWaitMs: 120,
        firstTextMs: 900,
        turnDurationMs: 2_400,
      }),
      readyMessage({
        id: "turn-2",
        createdAt: 2_000,
        model: "claude-sonnet-4",
        provider: "claude",
        socketToQueueMs: 60,
        queueWaitMs: 60,
        firstOutputMs: 700,
        turnDurationMs: 1_600,
      }),
      readyMessage({
        id: "turn-3",
        createdAt: 3_000,
        model: "gpt-5.4",
        provider: "codex",
        requestIds: ["req-3"],
        socketToQueueMs: 80,
        queueWaitMs: 180,
        firstTextMs: 1_100,
        turnDurationMs: 3_200,
      }),
    ]);

    expect(report).not.toBeNull();
    expect(report?.turnCount).toBe(3);
    expect(report?.correlatedTurnCount).toBe(2);
    expect(report?.latestTurn.id).toBe("turn-3");
    expect(report?.ttft.sampleCount).toBe(3);
    expect(report?.ttft.p50Ms).toBe(900);
    expect(report?.ttft.p95Ms).toBe(1_100);
    expect(report?.socketToQueue.p50Ms).toBe(60);
    expect(report?.socketToQueue.p95Ms).toBe(80);
    expect(report?.queueWait.p50Ms).toBe(120);
    expect(report?.queueWait.p95Ms).toBe(180);
    expect(report?.turnDuration.p50Ms).toBe(2_400);
    expect(report?.turnDuration.p95Ms).toBe(3_200);
    expect(report?.primaryDiagnosis.code).toBe("balanced");
  });

  it("prefers firstTextMs over firstOutputMs for ttft", () => {
    const report = buildSessionTimingDiagnosticsReport([
      readyMessage({
        id: "turn-1",
        createdAt: 1_000,
        provider: "claude",
        firstOutputMs: 600,
        firstTextMs: 800,
      }),
    ]);

    expect(report?.latestTurn.ttftMs).toBe(800);
    expect(report?.ttft.p50Ms).toBe(800);
  });

  it("detects queue wait as the primary bottleneck", () => {
    const report = buildSessionTimingDiagnosticsReport([
      readyMessage({
        id: "turn-1",
        createdAt: 1_000,
        requestIds: ["req-1"],
        queueWaitMs: 700,
        firstTextMs: 400,
        postFirstTextMs: 900,
        turnDurationMs: 1_300,
      }),
      readyMessage({
        id: "turn-2",
        createdAt: 2_000,
        requestIds: ["req-2"],
        queueWaitMs: 650,
        firstTextMs: 500,
        postFirstTextMs: 1_000,
        turnDurationMs: 1_500,
      }),
      readyMessage({
        id: "turn-3",
        createdAt: 3_000,
        requestIds: ["req-3"],
        queueWaitMs: 800,
        firstTextMs: 450,
        postFirstTextMs: 1_100,
        turnDurationMs: 1_550,
      }),
    ]);

    expect(report?.primaryDiagnosis.code).toBe("queue_wait");
  });

  it("detects slow first token as the primary bottleneck", () => {
    const report = buildSessionTimingDiagnosticsReport([
      readyMessage({
        id: "turn-1",
        createdAt: 1_000,
        requestIds: ["req-1"],
        queueWaitMs: 80,
        firstTextMs: 2_100,
        postFirstTextMs: 900,
        turnDurationMs: 3_000,
      }),
      readyMessage({
        id: "turn-2",
        createdAt: 2_000,
        requestIds: ["req-2"],
        queueWaitMs: 60,
        firstTextMs: 1_900,
        postFirstTextMs: 800,
        turnDurationMs: 2_800,
      }),
      readyMessage({
        id: "turn-3",
        createdAt: 3_000,
        requestIds: ["req-3"],
        queueWaitMs: 70,
        firstTextMs: 2_000,
        postFirstTextMs: 850,
        turnDurationMs: 2_900,
      }),
    ]);

    expect(report?.primaryDiagnosis.code).toBe("ttft");
  });

  it("detects slow generation tail as the primary bottleneck", () => {
    const report = buildSessionTimingDiagnosticsReport([
      readyMessage({
        id: "turn-1",
        createdAt: 1_000,
        requestIds: ["req-1"],
        queueWaitMs: 90,
        firstTextMs: 500,
        postFirstTextMs: 3_000,
        turnDurationMs: 3_500,
      }),
      readyMessage({
        id: "turn-2",
        createdAt: 2_000,
        requestIds: ["req-2"],
        queueWaitMs: 70,
        firstTextMs: 450,
        postFirstTextMs: 2_800,
        turnDurationMs: 3_250,
      }),
      readyMessage({
        id: "turn-3",
        createdAt: 3_000,
        requestIds: ["req-3"],
        queueWaitMs: 85,
        firstTextMs: 480,
        postFirstTextMs: 3_100,
        turnDurationMs: 3_600,
      }),
    ]);

    expect(report?.primaryDiagnosis.code).toBe("generation_tail");
  });

  it("builds a portable export payload for clipboard analysis", () => {
    const report = buildSessionTimingDiagnosticsReport([
      readyMessage({
        id: "turn-1",
        createdAt: 1_000,
        model: "claude-sonnet-4",
        provider: "claude",
        requestIds: ["req-1"],
        queueWaitMs: 120,
        firstTextMs: 900,
        turnDurationMs: 2_400,
      }),
      readyMessage({
        id: "turn-2",
        createdAt: 2_000,
        model: "claude-sonnet-4",
        provider: "claude",
        requestIds: ["req-2"],
        queueWaitMs: 60,
        firstOutputMs: 700,
        turnDurationMs: 1_600,
      }),
      readyMessage({
        id: "turn-3",
        createdAt: 3_000,
        model: "gpt-5.4",
        provider: "codex",
        requestIds: ["req-3"],
        queueWaitMs: 180,
        firstTextMs: 1_100,
        turnDurationMs: 3_200,
      }),
    ]);

    expect(report).not.toBeNull();

    const payload = buildSessionTimingDiagnosticsExport({
      sessionId: "session-1",
      sessionName: "happy",
      providerLabel: "Claude",
      exportedAtMs: 9_999,
      report: report!,
    });

    expect(payload).toMatchObject({
      version: 1,
      scope: "session",
      exportedAtMs: 9_999,
      session: {
        id: "session-1",
        name: "happy",
        provider: "Claude",
        latestModel: "gpt-5.4",
      },
      summary: {
        turnCount: 3,
        correlatedTurnCount: 3,
        primaryDiagnosis: {
          code: "balanced",
        },
      },
      latestTurn: {
        id: "turn-3",
      },
    });
    expect(payload.recentTurns).toHaveLength(3);
    expect(payload.metrics.ttft.p50Ms).toBe(900);
    expect(payload.metrics.turnDuration.p95Ms).toBe(3_200);
  });
});
