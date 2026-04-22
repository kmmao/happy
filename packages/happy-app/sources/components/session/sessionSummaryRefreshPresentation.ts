import type { Metadata } from "@/sync/storageTypes";

type SessionSummaryRefreshState = NonNullable<Metadata["sessionSummaryRefresh"]>;
type SessionSummaryRefreshActive = NonNullable<
  SessionSummaryRefreshState["active"]
>;
type SessionSummaryRefreshRecentEntry = NonNullable<
  SessionSummaryRefreshState["recent"]
>[number];

export type SessionSummaryRefreshDebugState =
  | {
      kind: "pending";
      protocolVersion: number;
      requestId: string;
      requestIdPreview: string;
      timestamp: number;
      requireSummary: boolean;
    }
  | {
      kind: "applied";
      protocolVersion: number;
      requestId: string;
      requestIdPreview: string;
      timestamp: number;
      summaryUpdatedAt?: number;
    }
  | {
      kind: "superseded";
      protocolVersion: number;
      requestId: string;
      requestIdPreview: string;
      timestamp: number;
      supersededByRequestId?: string;
      supersededByRequestIdPreview?: string;
    };

export function formatSummaryRefreshRequestIdPreview(requestId: string): string {
  const normalized = requestId.trim();
  if (normalized.length <= 24) {
    return normalized;
  }
  return `${normalized.slice(0, 17)}…${normalized.slice(-6)}`;
}

function resolveLatestRecentEntry(
  recent: readonly SessionSummaryRefreshRecentEntry[] | undefined,
): SessionSummaryRefreshRecentEntry | undefined {
  if (!recent || recent.length === 0) {
    return undefined;
  }
  return recent[recent.length - 1];
}

export function resolveSessionSummaryRefreshDebugState(
  refreshState: Metadata["sessionSummaryRefresh"] | null | undefined,
): SessionSummaryRefreshDebugState | null {
  if (!refreshState) {
    return null;
  }

  const active: SessionSummaryRefreshActive | undefined = refreshState.active;
  if (active) {
    return {
      kind: "pending",
      protocolVersion: refreshState.protocolVersion,
      requestId: active.requestId,
      requestIdPreview: formatSummaryRefreshRequestIdPreview(active.requestId),
      timestamp: active.requestedAt,
      requireSummary: active.requireSummary,
    };
  }

  const latestRecent = resolveLatestRecentEntry(refreshState.recent);
  if (!latestRecent) {
    return null;
  }

  if (latestRecent.status === "applied") {
    return {
      kind: "applied",
      protocolVersion: refreshState.protocolVersion,
      requestId: latestRecent.requestId,
      requestIdPreview: formatSummaryRefreshRequestIdPreview(
        latestRecent.requestId,
      ),
      timestamp: latestRecent.resolvedAt,
      summaryUpdatedAt: latestRecent.summaryUpdatedAt,
    };
  }

  return {
    kind: "superseded",
    protocolVersion: refreshState.protocolVersion,
    requestId: latestRecent.requestId,
    requestIdPreview: formatSummaryRefreshRequestIdPreview(
      latestRecent.requestId,
    ),
    timestamp: latestRecent.resolvedAt,
    supersededByRequestId: latestRecent.supersededByRequestId,
    supersededByRequestIdPreview: latestRecent.supersededByRequestId
      ? formatSummaryRefreshRequestIdPreview(latestRecent.supersededByRequestId)
      : undefined,
  };
}

export function buildSessionSummaryRefreshDebugText(
  debugState: SessionSummaryRefreshDebugState,
  options: {
    relativeTimeLabel: string;
    pending: (params: { requestId: string; time: string }) => string;
    applied: (params: { requestId: string; time: string }) => string;
    superseded: (params: { requestId: string; time: string }) => string;
  },
): string {
  if (debugState.kind === "pending") {
    return options.pending({
      requestId: debugState.requestIdPreview,
      time: options.relativeTimeLabel,
    });
  }

  if (debugState.kind === "applied") {
    return options.applied({
      requestId: debugState.requestIdPreview,
      time: options.relativeTimeLabel,
    });
  }

  return options.superseded({
    requestId: debugState.requestIdPreview,
    time: options.relativeTimeLabel,
  });
}
