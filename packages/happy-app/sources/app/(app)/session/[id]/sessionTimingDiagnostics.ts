import { Message } from "@/sync/typesMessage";
import { AgentEvent } from "@/sync/typesRaw";

type ReadyAgentEvent = Extract<AgentEvent, { type: "ready" }>;

export type SessionTimingMetricSummary = {
  sampleCount: number;
  averageMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
};

export type SessionTimingDiagnosticTurn = {
  id: string;
  createdAt: number;
  model: string | null;
  provider: string | null;
  requestIds: string[];
  queueWaitMs: number | null;
  socketToQueueMs: number | null;
  ttftMs: number | null;
  turnDurationMs: number | null;
  postFirstTextMs: number | null;
  postFirstOutputMs: number | null;
};

export type SessionTimingDiagnosticsReport = {
  turnCount: number;
  correlatedTurnCount: number;
  latestTurn: SessionTimingDiagnosticTurn;
  recentTurns: SessionTimingDiagnosticTurn[];
  socketToQueue: SessionTimingMetricSummary;
  ttft: SessionTimingMetricSummary;
  queueWait: SessionTimingMetricSummary;
  generationTail: SessionTimingMetricSummary;
  turnDuration: SessionTimingMetricSummary;
  primaryDiagnosis: SessionTimingDiagnosis;
};

export type SessionTimingDiagnosisCode =
  | "low_confidence"
  | "queue_wait"
  | "ttft"
  | "generation_tail"
  | "balanced";

export type SessionTimingDiagnosis = {
  code: SessionTimingDiagnosisCode;
};

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

export function summarizeSessionTimingMetric(
  values: Array<number | null | undefined>,
): SessionTimingMetricSummary {
  const normalized = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );

  if (normalized.length === 0) {
    return {
      sampleCount: 0,
      averageMs: null,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
    };
  }

  const total = normalized.reduce((sum, value) => sum + value, 0);

  return {
    sampleCount: normalized.length,
    averageMs: total / normalized.length,
    p50Ms: percentile(normalized, 50),
    p95Ms: percentile(normalized, 95),
    maxMs: Math.max(...normalized),
  };
}

function getReadyEvent(message: Message): ReadyAgentEvent | null {
  if (message.kind !== "agent-event" || message.event.type !== "ready") {
    return null;
  }
  return message.event;
}

export function extractSessionTimingDiagnosticTurns(
  messages: Message[],
): SessionTimingDiagnosticTurn[] {
  return messages
    .map((message) => {
      const event = getReadyEvent(message);
      const diagnostics = event?.diagnostics;
      if (!event || !diagnostics) {
        return null;
      }

      return {
        id: message.id,
        createdAt: message.createdAt,
        model: event.model ?? null,
        provider: diagnostics.provider ?? null,
        requestIds: diagnostics.requestIds ?? [],
        queueWaitMs: diagnostics.queueWaitMs ?? null,
        socketToQueueMs: diagnostics.socketToQueueMs ?? null,
        ttftMs: diagnostics.firstTextMs ?? diagnostics.firstOutputMs ?? null,
        turnDurationMs: diagnostics.turnDurationMs ?? null,
        postFirstTextMs: diagnostics.postFirstTextMs ?? null,
        postFirstOutputMs: diagnostics.postFirstOutputMs ?? null,
      } satisfies SessionTimingDiagnosticTurn;
    })
    .filter((turn): turn is SessionTimingDiagnosticTurn => turn !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function buildSessionTimingDiagnosticsReport(
  messages: Message[],
): SessionTimingDiagnosticsReport | null {
  const turns = extractSessionTimingDiagnosticTurns(messages);

  if (turns.length === 0) {
    return null;
  }

  const socketToQueue = summarizeSessionTimingMetric(
    turns.map((turn) => turn.socketToQueueMs),
  );
  const ttft = summarizeSessionTimingMetric(turns.map((turn) => turn.ttftMs));
  const queueWait = summarizeSessionTimingMetric(turns.map((turn) => turn.queueWaitMs));
  const generationTail = summarizeSessionTimingMetric(
    turns.map((turn) => turn.postFirstTextMs ?? turn.postFirstOutputMs),
  );
  const turnDuration = summarizeSessionTimingMetric(
    turns.map((turn) => turn.turnDurationMs),
  );
  const correlatedTurnCount = turns.filter(
    (turn) => turn.requestIds.length > 0,
  ).length;

  return {
    turnCount: turns.length,
    correlatedTurnCount,
    latestTurn: turns[0]!,
    recentTurns: turns.slice(0, 10),
    socketToQueue,
    ttft,
    queueWait,
    generationTail,
    turnDuration,
    primaryDiagnosis: diagnoseSessionTimingPrimaryIssue({
      turnCount: turns.length,
      correlatedTurnCount,
      ttftAverageMs: ttft.averageMs,
      queueWaitAverageMs: queueWait.averageMs,
      queueWaitP95Ms: queueWait.p95Ms,
      generationTailAverageMs: generationTail.averageMs,
      turnDurationAverageMs: turnDuration.averageMs,
    }),
  };
}

export function diagnoseSessionTimingPrimaryIssue(input: {
  turnCount: number;
  correlatedTurnCount: number;
  ttftAverageMs: number | null;
  queueWaitAverageMs: number | null;
  queueWaitP95Ms: number | null;
  generationTailAverageMs: number | null;
  turnDurationAverageMs: number | null;
}): SessionTimingDiagnosis {
  if (
    input.turnCount < 3 ||
    input.correlatedTurnCount < Math.ceil(input.turnCount / 2)
  ) {
    return { code: "low_confidence" };
  }

  const queueWaitAverageMs = input.queueWaitAverageMs ?? 0;
  const queueWaitP95Ms = input.queueWaitP95Ms ?? 0;
  const ttftAverageMs = input.ttftAverageMs ?? 0;
  const generationTailAverageMs = input.generationTailAverageMs ?? 0;
  const turnDurationAverageMs = input.turnDurationAverageMs ?? 0;

  const queueWaitScore =
    (queueWaitAverageMs >= 250 ? queueWaitAverageMs / 250 : 0) +
    (queueWaitP95Ms >= 500 ? 0.8 : 0) +
    (turnDurationAverageMs > 0 &&
    queueWaitAverageMs >= turnDurationAverageMs * 0.3
      ? 0.7
      : 0);

  const ttftScore =
    (ttftAverageMs >= 1200 ? ttftAverageMs / 1200 : 0) +
    (turnDurationAverageMs > 0 &&
    ttftAverageMs >= turnDurationAverageMs * 0.45
      ? 0.9
      : 0) +
    (queueWaitAverageMs <= 250 ? 0.2 : 0);

  const generationTailScore =
    (generationTailAverageMs >= 1500 ? generationTailAverageMs / 1500 : 0) +
    (turnDurationAverageMs > 0 &&
    generationTailAverageMs >= turnDurationAverageMs * 0.55
      ? 0.9
      : 0) +
    (ttftAverageMs <= 1200 ? 0.2 : 0);

  const ranked = [
    { code: "queue_wait" as const, score: queueWaitScore },
    { code: "ttft" as const, score: ttftScore },
    { code: "generation_tail" as const, score: generationTailScore },
  ].sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (!top || top.score < 1.25) {
    return { code: "balanced" };
  }

  return { code: top.code };
}

export type SessionTimingDiagnosticsExport = {
  version: 1;
  scope: "session";
  exportedAtMs: number;
  session: {
    id: string;
    name?: string;
    provider?: string | null;
    latestModel?: string | null;
  };
  summary: {
    turnCount: number;
    correlatedTurnCount: number;
    primaryDiagnosis: SessionTimingDiagnosis;
  };
  metrics: {
    socketToQueue: SessionTimingMetricSummary;
    ttft: SessionTimingMetricSummary;
    queueWait: SessionTimingMetricSummary;
    generationTail: SessionTimingMetricSummary;
    turnDuration: SessionTimingMetricSummary;
  };
  latestTurn: SessionTimingDiagnosticTurn;
  recentTurns: SessionTimingDiagnosticTurn[];
};

export function buildSessionTimingDiagnosticsExport(input: {
  sessionId: string;
  sessionName?: string;
  providerLabel?: string | null;
  exportedAtMs: number;
  report: SessionTimingDiagnosticsReport;
}): SessionTimingDiagnosticsExport {
  return {
    version: 1,
    scope: "session",
    exportedAtMs: input.exportedAtMs,
    session: {
      id: input.sessionId,
      ...(input.sessionName ? { name: input.sessionName } : {}),
      ...(input.providerLabel ? { provider: input.providerLabel } : {}),
      latestModel: input.report.latestTurn.model ?? null,
    },
    summary: {
      turnCount: input.report.turnCount,
      correlatedTurnCount: input.report.correlatedTurnCount,
      primaryDiagnosis: input.report.primaryDiagnosis,
    },
    metrics: {
      socketToQueue: input.report.socketToQueue,
      ttft: input.report.ttft,
      queueWait: input.report.queueWait,
      generationTail: input.report.generationTail,
      turnDuration: input.report.turnDuration,
    },
    latestTurn: input.report.latestTurn,
    recentTurns: input.report.recentTurns,
  };
}
