import { Session } from "@/sync/storageTypes";
import { Message } from "@/sync/typesMessage";
import {
  buildSessionTimingDiagnosticsReport,
  diagnoseSessionTimingPrimaryIssue,
  extractSessionTimingDiagnosticTurns,
  SessionTimingDiagnosis,
  SessionTimingDiagnosisCode,
  SessionTimingMetricSummary,
  summarizeSessionTimingMetric,
} from "./[id]/sessionTimingDiagnostics";

export type SessionTimingOverviewSessionEntry = {
  sessionId: string;
  sessionName: string;
  providerLabel: string;
  latestModel: string | null;
  latestTurnAt: number;
  turnCount: number;
  correlatedTurnCount: number;
  socketToQueue: SessionTimingMetricSummary;
  ttft: SessionTimingMetricSummary;
  queueWait: SessionTimingMetricSummary;
  generationTail: SessionTimingMetricSummary;
  turnDuration: SessionTimingMetricSummary;
  primaryDiagnosis: SessionTimingDiagnosis;
};

export type SessionTimingOverviewModelEntry = {
  key: string;
  providerLabel: string;
  model: string | null;
  latestTurnAt: number;
  sessionCount: number;
  turnCount: number;
  correlatedTurnCount: number;
  socketToQueue: SessionTimingMetricSummary;
  ttft: SessionTimingMetricSummary;
  queueWait: SessionTimingMetricSummary;
  generationTail: SessionTimingMetricSummary;
  turnDuration: SessionTimingMetricSummary;
  primaryDiagnosis: SessionTimingDiagnosis;
};

export type SessionTimingOverviewReport = {
  totalSessionCount: number;
  analyzedSessionCount: number;
  trackedModelCount: number;
  totalTurnCount: number;
  correlatedTurnCount: number;
  diagnosisCounts: Record<SessionTimingDiagnosisCode, number>;
  overall: {
    socketToQueue: SessionTimingMetricSummary;
    ttft: SessionTimingMetricSummary;
    queueWait: SessionTimingMetricSummary;
    generationTail: SessionTimingMetricSummary;
    turnDuration: SessionTimingMetricSummary;
    primaryDiagnosis: SessionTimingDiagnosis;
  };
  models: SessionTimingOverviewModelEntry[];
  sessions: SessionTimingOverviewSessionEntry[];
};

export type SessionTimingOverviewExport = {
  version: 1;
  scope: "overview";
  exportedAtMs: number;
  report: SessionTimingOverviewReport;
};

function createDiagnosisCounts(): Record<SessionTimingDiagnosisCode, number> {
  return {
    low_confidence: 0,
    queue_wait: 0,
    ttft: 0,
    generation_tail: 0,
    balanced: 0,
  };
}

function diagnoseFromTurns(
  turnCount: number,
  correlatedTurnCount: number,
  ttft: SessionTimingMetricSummary,
  queueWait: SessionTimingMetricSummary,
  generationTail: SessionTimingMetricSummary,
  turnDuration: SessionTimingMetricSummary,
): SessionTimingDiagnosis {
  return diagnoseSessionTimingPrimaryIssue({
    turnCount,
    correlatedTurnCount,
    ttftAverageMs: ttft.averageMs,
    queueWaitAverageMs: queueWait.averageMs,
    queueWaitP95Ms: queueWait.p95Ms,
    generationTailAverageMs: generationTail.averageMs,
    turnDurationAverageMs: turnDuration.averageMs,
  });
}

function resolveSessionName(session: Session): string {
  if (session.metadata?.summary?.text) {
    return session.metadata.summary.text;
  }

  const path = session.metadata?.path;
  if (path) {
    const segments = path.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? session.id;
  }

  return session.id;
}

function resolveSessionProviderKey(session: Session): string {
  const profileCandidates = [
    session.profileId?.toLowerCase(),
    session.profileName?.toLowerCase(),
  ].filter(Boolean) as string[];

  for (const candidate of profileCandidates) {
    if (candidate.includes("deepseek")) return "deepseek";
    if (
      candidate === "zai" ||
      candidate.includes("z.ai") ||
      candidate.includes("chatglm")
    ) {
      return "zai";
    }
    if (candidate.includes("minimax")) return "minimax";
    if (candidate.includes("kimi") || candidate.includes("moonshot")) {
      return "kimi";
    }
    if (candidate.includes("azure-openai")) return "azure-openai";
    if (candidate.includes("azure") && candidate.includes("openai")) {
      return "azure-openai";
    }
    if (
      candidate.includes("openai") ||
      candidate.includes("codex") ||
      candidate.includes("gpt")
    ) {
      return "codex";
    }
    if (candidate.includes("gemini")) return "gemini";
    if (candidate.includes("anthropic") || candidate.includes("claude")) {
      return "claude";
    }
    if (candidate.includes("opencode")) return "opencode";
    if (candidate === "acp") return "acp";
  }

  const flavor = session.metadata?.flavor?.toLowerCase();
  switch (flavor) {
    case "gpt":
    case "openai":
      return "codex";
    case "codex":
    case "gemini":
    case "opencode":
    case "acp":
      return flavor;
    case "claude":
    case undefined:
    case null:
      return "claude";
    default:
      return (flavor || "claude").trim() || "claude";
  }
}

function resolveSessionProviderLabel(session: Session): string {
  const key = resolveSessionProviderKey(session);

  switch (key) {
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
    case "claude":
      return "Claude";
    case "deepseek":
      return "DeepSeek";
    case "zai":
      return "Z.AI";
    case "minimax":
      return "MiniMax";
    case "kimi":
      return "Kimi";
    case "azure-openai":
      return "Azure OpenAI";
    case "opencode":
      return "OpenCode";
    case "acp":
      return "ACP";
    default:
      if (session.profileName && session.profileName.trim().length > 0) {
        return session.profileName;
      }
      return key.charAt(0).toUpperCase() + key.slice(1);
  }
}

export function buildSessionTimingOverviewReport(input: {
  sessions: Session[];
  sessionMessages: Record<string, { messages: Message[] } | undefined>;
}): SessionTimingOverviewReport | null {
  const analyzedSessions = input.sessions
    .map((session) => {
      const messages = input.sessionMessages[session.id]?.messages ?? [];
      const report = buildSessionTimingDiagnosticsReport(messages);
      if (!report) {
        return null;
      }

      return {
        session,
        report,
        turns: extractSessionTimingDiagnosticTurns(messages),
      };
    })
    .filter(
      (
        value,
      ): value is {
        session: Session;
        report: NonNullable<ReturnType<typeof buildSessionTimingDiagnosticsReport>>;
        turns: ReturnType<typeof extractSessionTimingDiagnosticTurns>;
      } => value !== null,
    );

  if (analyzedSessions.length === 0) {
    return null;
  }

  const diagnosisCounts = createDiagnosisCounts();
  for (const entry of analyzedSessions) {
    diagnosisCounts[entry.report.primaryDiagnosis.code] += 1;
  }

  const allTurns = analyzedSessions.flatMap((entry) => entry.turns);
  const correlatedTurnCount = allTurns.filter(
    (turn) => turn.requestIds.length > 0,
  ).length;

  const overallSocketToQueue = summarizeSessionTimingMetric(
    allTurns.map((turn) => turn.socketToQueueMs),
  );
  const overallTtft = summarizeSessionTimingMetric(
    allTurns.map((turn) => turn.ttftMs),
  );
  const overallQueueWait = summarizeSessionTimingMetric(
    allTurns.map((turn) => turn.queueWaitMs),
  );
  const overallGenerationTail = summarizeSessionTimingMetric(
    allTurns.map((turn) => turn.postFirstTextMs ?? turn.postFirstOutputMs),
  );
  const overallTurnDuration = summarizeSessionTimingMetric(
    allTurns.map((turn) => turn.turnDurationMs),
  );

  const modelsMap = new Map<
    string,
    {
      providerLabel: string;
      model: string | null;
      latestTurnAt: number;
      sessionIds: Set<string>;
      turns: typeof allTurns;
    }
  >();

  for (const entry of analyzedSessions) {
    const providerLabel = resolveSessionProviderLabel(entry.session);
    const fallbackModel =
      entry.report.latestTurn.model ??
      entry.session.resolvedModelId ??
      entry.session.metadata?.currentModelCode ??
      null;

    for (const turn of entry.turns) {
      const model = turn.model ?? fallbackModel;
      const key = `${providerLabel}::${model ?? "unknown"}`;
      const current = modelsMap.get(key);

      if (current) {
        current.turns.push(turn);
        current.sessionIds.add(entry.session.id);
        current.latestTurnAt = Math.max(current.latestTurnAt, turn.createdAt);
        continue;
      }

      modelsMap.set(key, {
        providerLabel,
        model,
        latestTurnAt: turn.createdAt,
        sessionIds: new Set([entry.session.id]),
        turns: [turn],
      });
    }
  }

  const models = Array.from(modelsMap.entries())
    .map(([key, value]) => {
      const correlatedTurns = value.turns.filter(
        (turn) => turn.requestIds.length > 0,
      ).length;
      const socketToQueue = summarizeSessionTimingMetric(
        value.turns.map((turn) => turn.socketToQueueMs),
      );
      const ttft = summarizeSessionTimingMetric(
        value.turns.map((turn) => turn.ttftMs),
      );
      const queueWait = summarizeSessionTimingMetric(
        value.turns.map((turn) => turn.queueWaitMs),
      );
      const generationTail = summarizeSessionTimingMetric(
        value.turns.map((turn) => turn.postFirstTextMs ?? turn.postFirstOutputMs),
      );
      const turnDuration = summarizeSessionTimingMetric(
        value.turns.map((turn) => turn.turnDurationMs),
      );

      return {
        key,
        providerLabel: value.providerLabel,
        model: value.model,
        latestTurnAt: value.latestTurnAt,
        sessionCount: value.sessionIds.size,
        turnCount: value.turns.length,
        correlatedTurnCount: correlatedTurns,
        socketToQueue,
        ttft,
        queueWait,
        generationTail,
        turnDuration,
        primaryDiagnosis: diagnoseFromTurns(
          value.turns.length,
          correlatedTurns,
          ttft,
          queueWait,
          generationTail,
          turnDuration,
        ),
      } satisfies SessionTimingOverviewModelEntry;
    })
    .sort((a, b) => {
      if (b.turnCount !== a.turnCount) {
        return b.turnCount - a.turnCount;
      }
      return (b.turnDuration.p95Ms ?? 0) - (a.turnDuration.p95Ms ?? 0);
    });

  const sessions = analyzedSessions
    .map(({ session, report }) => ({
      sessionId: session.id,
      sessionName: resolveSessionName(session),
      providerLabel: resolveSessionProviderLabel(session),
      latestModel:
        report.latestTurn.model ??
        session.resolvedModelId ??
        session.metadata?.currentModelCode ??
        null,
      latestTurnAt: report.latestTurn.createdAt,
      turnCount: report.turnCount,
      correlatedTurnCount: report.correlatedTurnCount,
      socketToQueue: report.socketToQueue,
      ttft: report.ttft,
      queueWait: report.queueWait,
      generationTail: report.generationTail,
      turnDuration: report.turnDuration,
      primaryDiagnosis: report.primaryDiagnosis,
    }))
    .sort((a, b) => {
      const durationGap = (b.turnDuration.p95Ms ?? 0) - (a.turnDuration.p95Ms ?? 0);
      if (durationGap !== 0) {
        return durationGap;
      }
      return b.latestTurnAt - a.latestTurnAt;
    });

  return {
    totalSessionCount: input.sessions.length,
    analyzedSessionCount: analyzedSessions.length,
    trackedModelCount: models.length,
    totalTurnCount: allTurns.length,
    correlatedTurnCount,
    diagnosisCounts,
    overall: {
      socketToQueue: overallSocketToQueue,
      ttft: overallTtft,
      queueWait: overallQueueWait,
      generationTail: overallGenerationTail,
      turnDuration: overallTurnDuration,
      primaryDiagnosis: diagnoseFromTurns(
        allTurns.length,
        correlatedTurnCount,
        overallTtft,
        overallQueueWait,
        overallGenerationTail,
        overallTurnDuration,
      ),
    },
    models,
    sessions,
  };
}

export function buildSessionTimingOverviewExport(input: {
  exportedAtMs: number;
  report: SessionTimingOverviewReport;
}): SessionTimingOverviewExport {
  return {
    version: 1,
    scope: "overview",
    exportedAtMs: input.exportedAtMs,
    report: input.report,
  };
}
