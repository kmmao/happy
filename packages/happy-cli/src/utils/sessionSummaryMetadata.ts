import type { Metadata } from "@/api/types";

type SessionSummaryState = NonNullable<Metadata["sessionSummary"]>;
type SessionSummaryRefreshState = NonNullable<Metadata["sessionSummaryRefresh"]>;
type SessionSummaryRefreshRecentEntry = NonNullable<
  SessionSummaryRefreshState["recent"]
>[number];

const MAX_RECENT_SUMMARY_REQUESTS = 4;

export interface ApplySessionSummaryUpdateInput {
  goal: string;
  currentFocus?: string;
  keyDecisions?: string[];
  openQuestions?: string[];
  impactScope?: string[];
  requestId?: string;
  now?: number;
}

function appendRecentEntry(
  existing: readonly SessionSummaryRefreshRecentEntry[] | undefined,
  entry: SessionSummaryRefreshRecentEntry,
): SessionSummaryRefreshRecentEntry[] {
  return [
    ...(existing ?? []).filter((item) => item.requestId !== entry.requestId),
    entry,
  ].slice(-MAX_RECENT_SUMMARY_REQUESTS);
}

function applyRefreshAck(
  refreshState: Metadata["sessionSummaryRefresh"],
  inputRequestId: string | undefined,
  updatedAt: number,
): Metadata["sessionSummaryRefresh"] {
  if (!refreshState) {
    return refreshState;
  }

  const requestId = inputRequestId;
  if (!requestId) {
    return refreshState;
  }

  const shouldClearActive =
    refreshState.active != null && refreshState.active.requestId === requestId;

  return {
    protocolVersion: refreshState.protocolVersion,
    active: shouldClearActive ? undefined : refreshState.active,
    recent: appendRecentEntry(refreshState.recent, {
      requestId,
      status: "applied",
      resolvedAt: updatedAt,
      summaryUpdatedAt: updatedAt,
    }),
  };
}

function mergeStringArrays(
  existing: readonly string[] | undefined,
  incoming: readonly string[] | undefined,
): string[] | undefined {
  if (!incoming || incoming.length === 0) return existing ? [...existing] : undefined;
  if (!existing || existing.length === 0) return [...incoming];
  const seen = new Set(existing);
  const merged = [...existing];
  for (const item of incoming) {
    if (!seen.has(item)) {
      merged.push(item);
      seen.add(item);
    }
  }
  return merged;
}

export function applySessionSummaryUpdate<T extends Metadata>(
  metadata: T,
  input: ApplySessionSummaryUpdateInput,
): T & Pick<Metadata, "sessionSummary" | "sessionSummaryRefresh"> {
  const updatedAt = input.now ?? Date.now();
  const prev = metadata.sessionSummary;
  const sessionSummary: SessionSummaryState = {
    goal: input.goal,
    currentFocus: input.currentFocus,
    keyDecisions: mergeStringArrays(prev?.keyDecisions, input.keyDecisions),
    openQuestions: input.openQuestions,
    impactScope: mergeStringArrays(prev?.impactScope, input.impactScope),
    updatedAt,
  };

  return {
    ...metadata,
    sessionSummary,
    sessionSummaryRefresh: applyRefreshAck(
      metadata.sessionSummaryRefresh,
      input.requestId,
      updatedAt,
    ),
  };
}
