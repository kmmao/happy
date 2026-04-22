import {
  sessionSummaryRefreshStateSchema,
  sessionSummaryStateSchema,
  type SessionSummaryRefreshRecentEntry,
  type SessionSummaryRefreshState,
  type SessionSummaryState,
} from "@kmmao/happy-wire";

const MAX_RECENT_SUMMARY_REQUESTS = 4;

export function buildSummaryRefreshPrompt(requestId: string): string {
  return [
    "Please call mcp__happy__update_session_summary to record the current session summary with: goal, currentFocus, keyDecisions (if any), openQuestions (if any), impactScope (if any). Keep it accurate and concise.",
    "",
    `Request ID: ${requestId}`,
    "Important: include this requestId exactly in the tool input as `requestId` when you call mcp__happy__update_session_summary.",
  ].join("\n");
}

function toMetadataRecord(metadata: unknown): Record<string, unknown> {
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
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

export function extractSessionSummaryState(
  metadata: unknown,
): SessionSummaryState | null {
  const parsed = sessionSummaryStateSchema.safeParse(
    toMetadataRecord(metadata).sessionSummary,
  );
  return parsed.success ? parsed.data : null;
}

export function extractSessionSummaryRefreshState(
  metadata: unknown,
): SessionSummaryRefreshState | null {
  const parsed = sessionSummaryRefreshStateSchema.safeParse(
    toMetadataRecord(metadata).sessionSummaryRefresh,
  );
  return parsed.success ? parsed.data : null;
}

function summariesDiffer(
  previous: SessionSummaryState,
  next: SessionSummaryState,
): boolean {
  return JSON.stringify(previous) !== JSON.stringify(next);
}

export function getUpdatedSessionSummaryState(args: {
  previousMetadata: unknown;
  nextMetadata: unknown;
}): SessionSummaryState | null {
  const previous = extractSessionSummaryState(args.previousMetadata);
  const next = extractSessionSummaryState(args.nextMetadata);

  if (!next) {
    return null;
  }
  if (!previous) {
    return next;
  }
  if (next.updatedAt > previous.updatedAt) {
    return next;
  }
  if (next.updatedAt === previous.updatedAt && summariesDiffer(previous, next)) {
    return next;
  }
  return null;
}

export function resolveRequiredSessionSummary(
  metadata: unknown,
  previousUpdatedAt: number | null | undefined,
): SessionSummaryState | null {
  const summary = extractSessionSummaryState(metadata);
  if (!summary) {
    return null;
  }
  if (previousUpdatedAt == null) {
    return summary;
  }
  return summary.updatedAt > previousUpdatedAt ? summary : null;
}

export function buildActiveSummaryRefreshState(args: {
  metadata: unknown;
  requestId: string;
  requestedAt: number;
  requireSummary: boolean;
}): SessionSummaryRefreshState {
  const existing = extractSessionSummaryRefreshState(args.metadata);
  const previousActive = existing?.active;
  const recent = previousActive && previousActive.requestId !== args.requestId
    ? appendRecentEntry(existing?.recent, {
        requestId: previousActive.requestId,
        status: "superseded",
        resolvedAt: args.requestedAt,
        supersededByRequestId: args.requestId,
      })
    : [...(existing?.recent ?? [])];

  return {
    protocolVersion: 1,
    active: {
      requestId: args.requestId,
      requestedAt: args.requestedAt,
      requester: "happy-agent",
      command: "summary-refresh",
      requireSummary: args.requireSummary,
    },
    recent,
  };
}

export function getRecentSummaryRefreshEntry(
  metadata: unknown,
  requestId: string,
): SessionSummaryRefreshRecentEntry | null {
  const refresh = extractSessionSummaryRefreshState(metadata);
  const recent = refresh?.recent;
  if (!recent) {
    return null;
  }

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index]?.requestId === requestId) {
      return recent[index] ?? null;
    }
  }
  return null;
}

type SessionSummaryWaitClient = {
  getMetadata(): unknown | null;
  on<T extends (...args: any[]) => void>(event: string, listener: T): unknown;
  removeListener<T extends (...args: any[]) => void>(
    event: string,
    listener: T,
  ): unknown;
};

type WaitByPreviousMetadataOpts = {
  previousMetadata: unknown;
  timeoutMs: number;
};

type WaitByUpdatedAtOpts = {
  previousUpdatedAt: number | null | undefined;
  timeoutMs: number;
};

function isWaitOpts(
  value: unknown,
): value is WaitByPreviousMetadataOpts | WaitByUpdatedAtOpts {
  return typeof value === "object" && value !== null && "timeoutMs" in value;
}

function isWaitByUpdatedAtOpts(
  value: WaitByPreviousMetadataOpts | WaitByUpdatedAtOpts,
): value is WaitByUpdatedAtOpts {
  return "previousUpdatedAt" in value;
}

export function waitForSessionSummaryUpdate(
  client: SessionSummaryWaitClient,
  previousMetadata: unknown,
  timeoutMs: number,
): Promise<SessionSummaryState>;
export function waitForSessionSummaryUpdate(
  client: SessionSummaryWaitClient,
  opts: WaitByPreviousMetadataOpts,
): Promise<SessionSummaryState>;
export function waitForSessionSummaryUpdate(
  client: SessionSummaryWaitClient,
  opts: WaitByUpdatedAtOpts,
): Promise<SessionSummaryState>;
export function waitForSessionSummaryUpdate(
  client: SessionSummaryWaitClient,
  previousMetadataOrOpts:
    | unknown
    | WaitByPreviousMetadataOpts
    | WaitByUpdatedAtOpts,
  maybeTimeoutMs?: number,
): Promise<SessionSummaryState> {
  const resolver = isWaitOpts(previousMetadataOrOpts)
    ? {
        timeoutMs: previousMetadataOrOpts.timeoutMs,
        resolve: (metadata: unknown) => {
          if (isWaitByUpdatedAtOpts(previousMetadataOrOpts)) {
            return resolveRequiredSessionSummary(
              metadata,
              previousMetadataOrOpts.previousUpdatedAt,
            );
          }
          return getUpdatedSessionSummaryState({
            previousMetadata: previousMetadataOrOpts.previousMetadata,
            nextMetadata: metadata,
          });
        },
      }
    : {
        timeoutMs: maybeTimeoutMs ?? 0,
        resolve: (metadata: unknown) =>
          getUpdatedSessionSummaryState({
            previousMetadata: previousMetadataOrOpts,
            nextMetadata: metadata,
          }),
      };

  const immediate = resolver.resolve(client.getMetadata());
  if (immediate) {
    return Promise.resolve(immediate);
  }

  return new Promise<SessionSummaryState>((resolve, reject) => {
    const onStateChange = (data: { metadata?: unknown }) => {
      const updated = resolver.resolve(data.metadata ?? client.getMetadata());
      if (!updated) {
        return;
      }
      cleanup();
      resolve(updated);
    };

    const onDisconnect = () => {
      cleanup();
      reject(
        new Error("Socket disconnected while waiting for session summary update"),
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      client.removeListener("state-change", onStateChange);
      client.removeListener("disconnected", onDisconnect);
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for session summary update"));
    }, resolver.timeoutMs);

    client.on("state-change", onStateChange);
    client.on("disconnected", onDisconnect);
  });
}

export function waitForSummaryRefreshRecentApplied(
  client: SessionSummaryWaitClient,
  opts: {
    requestId: string;
    timeoutMs: number;
  },
): Promise<SessionSummaryRefreshRecentEntry> {
  const getEntry = (metadata: unknown): SessionSummaryRefreshRecentEntry | null =>
    getRecentSummaryRefreshEntry(metadata, opts.requestId);

  const immediate = getEntry(client.getMetadata());
  if (immediate?.status === "applied") {
    return Promise.resolve(immediate);
  }
  if (immediate?.status === "superseded") {
    return Promise.reject(
      new Error(
        `Summary refresh request ${opts.requestId} was superseded${
          immediate.supersededByRequestId
            ? ` by ${immediate.supersededByRequestId}`
            : ""
        }`,
      ),
    );
  }

  return new Promise<SessionSummaryRefreshRecentEntry>((resolve, reject) => {
    const onStateChange = (data: { metadata?: unknown }) => {
      const entry = getEntry(data.metadata ?? client.getMetadata());
      if (!entry) {
        return;
      }
      if (entry.status === "applied") {
        cleanup();
        resolve(entry);
        return;
      }
      cleanup();
      reject(
        new Error(
          `Summary refresh request ${opts.requestId} was superseded${
            entry.supersededByRequestId ? ` by ${entry.supersededByRequestId}` : ""
          }`,
        ),
      );
    };

    const onDisconnect = () => {
      cleanup();
      reject(
        new Error(
          "Socket disconnected while waiting for summary refresh acknowledgement",
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      client.removeListener("state-change", onStateChange);
      client.removeListener("disconnected", onDisconnect);
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for summary refresh acknowledgement"));
    }, opts.timeoutMs);

    client.on("state-change", onStateChange);
    client.on("disconnected", onDisconnect);
  });
}
