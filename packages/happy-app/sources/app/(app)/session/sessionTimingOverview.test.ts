import { describe, expect, it } from "vitest";

import { Message } from "@/sync/typesMessage";
import { Session } from "@/sync/storageTypes";
import { buildSessionTimingOverviewReport } from "./sessionTimingOverview";

function makeSession(input: {
  id: string;
  updatedAt?: number;
  path?: string;
  flavor?: string | null;
  profileName?: string | null;
}): Session {
  return {
    id: input.id,
    seq: 1,
    createdAt: input.updatedAt ?? 1_000,
    updatedAt: input.updatedAt ?? 1_000,
    active: false,
    activeAt: input.updatedAt ?? 1_000,
    rpcReady: false,
    thinking: false,
    thinkingAt: input.updatedAt ?? 1_000,
    presence: input.updatedAt ?? 1_000,
    metadata: {
      path: input.path ?? `/repo/${input.id}`,
      host: "mbp",
      flavor: input.flavor ?? "claude",
    },
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 1,
    preferencesVersion: 1,
    profileName: input.profileName ?? null,
  };
}

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

describe("buildSessionTimingOverviewReport", () => {
  it("returns null when no sessions have request diagnostics", () => {
    const report = buildSessionTimingOverviewReport({
      sessions: [makeSession({ id: "session-1" })],
      sessionMessages: {
        "session-1": {
          messages: [
            {
              kind: "agent-text",
              id: "text-1",
              localId: null,
              createdAt: 100,
              text: "hello",
            },
          ],
        },
      },
    });

    expect(report).toBeNull();
  });

  it("aggregates diagnostics by session and model", () => {
    const report = buildSessionTimingOverviewReport({
      sessions: [
        makeSession({
          id: "session-queue",
          updatedAt: 4_000,
          flavor: "claude",
          profileName: "Claude",
        }),
        makeSession({
          id: "session-ttft",
          updatedAt: 8_000,
          flavor: "codex",
          profileName: "Codex",
        }),
      ],
      sessionMessages: {
        "session-queue": {
          messages: [
            readyMessage({
              id: "queue-1",
              createdAt: 1_000,
              model: "claude-sonnet-4",
              provider: "claude",
              requestIds: ["req-1"],
              socketToQueueMs: 50,
              queueWaitMs: 700,
              firstTextMs: 400,
              postFirstTextMs: 900,
              turnDurationMs: 1_300,
            }),
            readyMessage({
              id: "queue-2",
              createdAt: 2_000,
              model: "claude-sonnet-4",
              provider: "claude",
              requestIds: ["req-2"],
              socketToQueueMs: 45,
              queueWaitMs: 650,
              firstTextMs: 500,
              postFirstTextMs: 1_000,
              turnDurationMs: 1_500,
            }),
            readyMessage({
              id: "queue-3",
              createdAt: 3_000,
              model: "claude-sonnet-4",
              provider: "claude",
              requestIds: ["req-3"],
              socketToQueueMs: 55,
              queueWaitMs: 800,
              firstTextMs: 450,
              postFirstTextMs: 1_100,
              turnDurationMs: 1_550,
            }),
          ],
        },
        "session-ttft": {
          messages: [
            readyMessage({
              id: "ttft-1",
              createdAt: 5_000,
              model: "gpt-5.4",
              provider: "codex",
              requestIds: ["req-4"],
              socketToQueueMs: 70,
              queueWaitMs: 80,
              firstTextMs: 2_100,
              postFirstTextMs: 900,
              turnDurationMs: 3_000,
            }),
            readyMessage({
              id: "ttft-2",
              createdAt: 6_000,
              model: "gpt-5.4",
              provider: "codex",
              requestIds: ["req-5"],
              socketToQueueMs: 60,
              queueWaitMs: 60,
              firstTextMs: 1_900,
              postFirstTextMs: 800,
              turnDurationMs: 2_800,
            }),
            readyMessage({
              id: "ttft-3",
              createdAt: 7_000,
              model: "gpt-5.4",
              provider: "codex",
              requestIds: ["req-6"],
              socketToQueueMs: 65,
              queueWaitMs: 70,
              firstTextMs: 2_000,
              postFirstTextMs: 850,
              turnDurationMs: 2_900,
            }),
          ],
        },
      },
    });

    expect(report).not.toBeNull();
    expect(report?.totalSessionCount).toBe(2);
    expect(report?.analyzedSessionCount).toBe(2);
    expect(report?.trackedModelCount).toBe(2);
    expect(report?.totalTurnCount).toBe(6);
    expect(report?.correlatedTurnCount).toBe(6);
    expect(report?.overall.socketToQueue.p50Ms).toBe(55);
    expect(report?.diagnosisCounts.queue_wait).toBe(1);
    expect(report?.diagnosisCounts.ttft).toBe(1);

    const queueModel = report?.models.find(
      (bucket) => bucket.model === "claude-sonnet-4",
    );
    expect(queueModel).toMatchObject({
      sessionCount: 1,
      turnCount: 3,
      primaryDiagnosis: {
        code: "queue_wait",
      },
    });

    const ttftSession = report?.sessions.find(
      (entry) => entry.sessionId === "session-ttft",
    );
    expect(ttftSession).toMatchObject({
      sessionName: "session-ttft",
      providerLabel: "Codex",
      latestModel: "gpt-5.4",
      primaryDiagnosis: {
        code: "ttft",
      },
    });
    expect(ttftSession?.ttft.p95Ms).toBe(2_100);
  });
});
