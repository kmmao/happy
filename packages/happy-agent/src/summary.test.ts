import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  buildActiveSummaryRefreshState,
  buildSummaryRefreshPrompt,
  extractSessionSummaryRefreshState,
  extractSessionSummaryState,
  getRecentSummaryRefreshEntry,
  getUpdatedSessionSummaryState,
  waitForSessionSummaryUpdate,
  waitForSummaryRefreshRecentApplied,
} from "./summary";

describe("buildSummaryRefreshPrompt", () => {
  it("embeds the requestId and instructs the agent to echo it back", () => {
    const prompt = buildSummaryRefreshPrompt("summary-refresh_123");

    expect(prompt).toContain("Request ID: summary-refresh_123");
    expect(prompt).toContain(
      "include this requestId exactly in the tool input",
    );
  });
});

describe("extractSessionSummaryState", () => {
  it("returns null for invalid metadata", () => {
    expect(extractSessionSummaryState(null)).toBeNull();
    expect(extractSessionSummaryState({})).toBeNull();
    expect(
      extractSessionSummaryState({
        sessionSummary: {
          goal: "",
          updatedAt: "bad",
        },
      }),
    ).toBeNull();
  });
});

describe("extractSessionSummaryRefreshState", () => {
  it("returns null for invalid refresh metadata", () => {
    expect(extractSessionSummaryRefreshState(null)).toBeNull();
    expect(extractSessionSummaryRefreshState({})).toBeNull();
    expect(
      extractSessionSummaryRefreshState({
        sessionSummaryRefresh: {
          protocolVersion: 2,
        },
      }),
    ).toBeNull();
  });
});

describe("getUpdatedSessionSummaryState", () => {
  it("detects the first summary appearance", () => {
    const summary = getUpdatedSessionSummaryState({
      previousMetadata: {},
      nextMetadata: {
        sessionSummary: {
          goal: "Ship summary refresh",
          updatedAt: 100,
        },
      },
    });

    expect(summary).toMatchObject({
      goal: "Ship summary refresh",
      updatedAt: 100,
    });
  });

  it("ignores unchanged summaries", () => {
    const summary = getUpdatedSessionSummaryState({
      previousMetadata: {
        sessionSummary: {
          goal: "Stable",
          updatedAt: 100,
        },
      },
      nextMetadata: {
        sessionSummary: {
          goal: "Stable",
          updatedAt: 100,
        },
      },
    });

    expect(summary).toBeNull();
  });
});

describe("buildActiveSummaryRefreshState", () => {
  it("starts a new active request while preserving recent history", () => {
    const refresh = buildActiveSummaryRefreshState({
      metadata: {
        sessionSummaryRefresh: {
          protocolVersion: 1,
          recent: [
            {
              requestId: "older",
              status: "applied",
              resolvedAt: 50,
              summaryUpdatedAt: 50,
            },
          ],
        },
      },
      requestId: "summary-refresh_123",
      requestedAt: 100,
      requireSummary: true,
    });

    expect(refresh).toEqual({
      protocolVersion: 1,
      active: {
        requestId: "summary-refresh_123",
        requestedAt: 100,
        requester: "happy-agent",
        command: "summary-refresh",
        requireSummary: true,
      },
      recent: [
        {
          requestId: "older",
          status: "applied",
          resolvedAt: 50,
          summaryUpdatedAt: 50,
        },
      ],
    });
  });

  it("marks a prior active request as superseded when replaced", () => {
    const refresh = buildActiveSummaryRefreshState({
      metadata: {
        sessionSummaryRefresh: {
          protocolVersion: 1,
          active: {
            requestId: "summary-refresh_old",
            requestedAt: 80,
            requester: "happy-agent",
            command: "summary-refresh",
            requireSummary: true,
          },
          recent: [],
        },
      },
      requestId: "summary-refresh_new",
      requestedAt: 100,
      requireSummary: true,
    });

    expect(refresh.recent).toEqual([
      {
        requestId: "summary-refresh_old",
        status: "superseded",
        resolvedAt: 100,
        supersededByRequestId: "summary-refresh_new",
      },
    ]);
  });
});

describe("getRecentSummaryRefreshEntry", () => {
  it("finds a matching recent request entry", () => {
    const entry = getRecentSummaryRefreshEntry(
      {
        sessionSummaryRefresh: {
          protocolVersion: 1,
          recent: [
            {
              requestId: "summary-refresh_123",
              status: "applied",
              resolvedAt: 100,
              summaryUpdatedAt: 100,
            },
          ],
        },
      },
      "summary-refresh_123",
    );

    expect(entry).toMatchObject({
      requestId: "summary-refresh_123",
      status: "applied",
    });
  });
});

class FakeSummaryClient extends EventEmitter {
  private metadata: unknown;

  constructor(initialMetadata: unknown) {
    super();
    this.metadata = initialMetadata;
  }

  getMetadata(): unknown {
    return this.metadata;
  }

  pushMetadata(metadata: unknown): void {
    this.metadata = metadata;
    this.emit("state-change", { metadata, agentState: null });
  }
}

describe("waitForSessionSummaryUpdate", () => {
  it("resolves when a refreshed summary arrives", async () => {
    const client = new FakeSummaryClient({});
    const pending = waitForSessionSummaryUpdate(client, {
      previousMetadata: {},
      timeoutMs: 1000,
    });

    client.pushMetadata({
      sessionSummary: {
        goal: "Ship summary refresh",
        updatedAt: 100,
      },
    });

    await expect(pending).resolves.toMatchObject({
      goal: "Ship summary refresh",
      updatedAt: 100,
    });
  });
});

describe("waitForSummaryRefreshRecentApplied", () => {
  it("resolves when a matching recent applied entry appears", async () => {
    const client = new FakeSummaryClient({
      sessionSummaryRefresh: {
        protocolVersion: 1,
        active: {
          requestId: "summary-refresh_123",
          requestedAt: 10,
          requester: "happy-agent",
          command: "summary-refresh",
          requireSummary: true,
        },
        recent: [],
      },
    });

    const pending = waitForSummaryRefreshRecentApplied(client, {
      requestId: "summary-refresh_123",
      timeoutMs: 1000,
    });

    client.pushMetadata({
      sessionSummaryRefresh: {
        protocolVersion: 1,
        recent: [
          {
            requestId: "summary-refresh_123",
            status: "applied",
            resolvedAt: 100,
            summaryUpdatedAt: 100,
          },
        ],
      },
    });

    await expect(pending).resolves.toMatchObject({
      requestId: "summary-refresh_123",
      status: "applied",
    });
  });

  it("rejects when the matching request is superseded", async () => {
    const client = new FakeSummaryClient({
      sessionSummaryRefresh: {
        protocolVersion: 1,
        recent: [],
      },
    });

    const pending = waitForSummaryRefreshRecentApplied(client, {
      requestId: "summary-refresh_123",
      timeoutMs: 1000,
    });

    client.pushMetadata({
      sessionSummaryRefresh: {
        protocolVersion: 1,
        recent: [
          {
            requestId: "summary-refresh_123",
            status: "superseded",
            resolvedAt: 120,
            supersededByRequestId: "summary-refresh_124",
          },
        ],
      },
    });

    await expect(pending).rejects.toThrow("was superseded");
  });

  it("rejects when the request is never acknowledged", async () => {
    const client = new FakeSummaryClient({
      sessionSummaryRefresh: {
        protocolVersion: 1,
        recent: [],
      },
    });

    await expect(
      waitForSummaryRefreshRecentApplied(client, {
        requestId: "summary-refresh_404",
        timeoutMs: 10,
      }),
    ).rejects.toThrow("Timeout waiting for summary refresh acknowledgement");
  });
});
