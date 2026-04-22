import { describe, expect, it } from "vitest";

import { applySessionSummaryUpdate } from "./sessionSummaryMetadata";

describe("applySessionSummaryUpdate", () => {
  it("writes sessionSummary and consumes an active refresh request into recent applied history", () => {
    const result = applySessionSummaryUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        sessionSummaryRefresh: {
          protocolVersion: 1,
          active: {
            requestId: "summary-refresh_123",
            requestedAt: 80,
            requester: "happy-agent",
            command: "summary-refresh",
            requireSummary: true,
          },
          recent: [
            {
              requestId: "summary-refresh_122",
              status: "superseded",
              resolvedAt: 70,
              supersededByRequestId: "summary-refresh_123",
            },
          ],
        },
      },
      {
        goal: "Ship summary ack",
        currentFocus: "Wire request id through control plane",
        requestId: "summary-refresh_123",
        now: 100,
      },
    );

    expect(result.sessionSummary).toMatchObject({
      goal: "Ship summary ack",
      currentFocus: "Wire request id through control plane",
      updatedAt: 100,
    });
    expect(result.sessionSummaryRefresh).toEqual({
      protocolVersion: 1,
      active: undefined,
      recent: [
        {
          requestId: "summary-refresh_122",
          status: "superseded",
          resolvedAt: 70,
          supersededByRequestId: "summary-refresh_123",
        },
        {
          requestId: "summary-refresh_123",
          status: "applied",
          resolvedAt: 100,
          summaryUpdatedAt: 100,
        },
      ],
    });
  });

  it("preserves protocol state when no active summary refresh request exists", () => {
    const result = applySessionSummaryUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        sessionSummaryRefresh: {
          protocolVersion: 1,
          recent: [
            {
              requestId: "summary-refresh_120",
              status: "applied",
              resolvedAt: 50,
              summaryUpdatedAt: 50,
            },
          ],
        },
      },
      {
        goal: "Rewrite summary without active request",
        now: 200,
      },
    );

    expect(result.sessionSummary).toMatchObject({
      goal: "Rewrite summary without active request",
      updatedAt: 200,
    });
    expect(result.sessionSummaryRefresh).toEqual({
      protocolVersion: 1,
      active: undefined,
      recent: [
        {
          requestId: "summary-refresh_120",
          status: "applied",
          resolvedAt: 50,
          summaryUpdatedAt: 50,
        },
      ],
    });
  });

  it("does not resolve an active request when update_session_summary omitted requestId", () => {
    const result = applySessionSummaryUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        sessionSummaryRefresh: {
          protocolVersion: 1,
          active: {
            requestId: "summary-refresh_150",
            requestedAt: 140,
            requester: "happy-agent",
            command: "summary-refresh",
            requireSummary: true,
          },
          recent: [
            {
              requestId: "summary-refresh_120",
              status: "applied",
              resolvedAt: 50,
              summaryUpdatedAt: 50,
            },
          ],
        },
      },
      {
        goal: "Summary without ack id",
        now: 200,
      },
    );

    expect(result.sessionSummaryRefresh).toEqual({
      protocolVersion: 1,
      active: {
        requestId: "summary-refresh_150",
        requestedAt: 140,
        requester: "happy-agent",
        command: "summary-refresh",
        requireSummary: true,
      },
      recent: [
        {
          requestId: "summary-refresh_120",
          status: "applied",
          resolvedAt: 50,
          summaryUpdatedAt: 50,
        },
      ],
    });
  });

  it("trims recent request history to the most recent four entries", () => {
    const result = applySessionSummaryUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        sessionSummaryRefresh: {
          protocolVersion: 1,
          active: {
            requestId: "summary-refresh_200",
            requestedAt: 99,
            requester: "happy-agent",
            command: "summary-refresh",
            requireSummary: false,
          },
          recent: [
            { requestId: "r1", status: "applied", resolvedAt: 1, summaryUpdatedAt: 1 },
            { requestId: "r2", status: "applied", resolvedAt: 2, summaryUpdatedAt: 2 },
            { requestId: "r3", status: "applied", resolvedAt: 3, summaryUpdatedAt: 3 },
            { requestId: "r4", status: "applied", resolvedAt: 4, summaryUpdatedAt: 4 },
          ],
        },
      },
      {
        goal: "Trim recent",
        requestId: "summary-refresh_200",
        now: 300,
      },
    );

    expect(result.sessionSummaryRefresh?.recent).toEqual([
      { requestId: "r2", status: "applied", resolvedAt: 2, summaryUpdatedAt: 2 },
      { requestId: "r3", status: "applied", resolvedAt: 3, summaryUpdatedAt: 3 },
      { requestId: "r4", status: "applied", resolvedAt: 4, summaryUpdatedAt: 4 },
      {
        requestId: "summary-refresh_200",
        status: "applied",
        resolvedAt: 300,
        summaryUpdatedAt: 300,
      },
    ]);
  });

  it("does not clear a different active request when applying a non-active requestId", () => {
    const result = applySessionSummaryUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        sessionSummaryRefresh: {
          protocolVersion: 1,
          active: {
            requestId: "summary-refresh_live",
            requestedAt: 90,
            requester: "happy-agent",
            command: "summary-refresh",
            requireSummary: true,
          },
          recent: [],
        },
      },
      {
        goal: "Late-arriving summary write",
        requestId: "summary-refresh_old",
        now: 120,
      },
    );

    expect(result.sessionSummaryRefresh).toEqual({
      protocolVersion: 1,
      active: {
        requestId: "summary-refresh_live",
        requestedAt: 90,
        requester: "happy-agent",
        command: "summary-refresh",
        requireSummary: true,
      },
      recent: [
        {
          requestId: "summary-refresh_old",
          status: "applied",
          resolvedAt: 120,
          summaryUpdatedAt: 120,
        },
      ],
    });
  });
});
