import { describe, expect, it } from "vitest";

import type { Metadata } from "@/api/types";
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

  it("appends new keyDecisions to existing ones without duplicates", () => {
    const result = applySessionSummaryUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        sessionSummary: {
          goal: "Build feature X",
          keyDecisions: ["Chose approach A", "Used library B"],
          impactScope: ["auth module"],
          updatedAt: 50,
        },
      },
      {
        goal: "Build feature X (phase 2)",
        keyDecisions: ["Used library B", "Switched to strategy C"],
        impactScope: ["auth module", "payments module"],
        now: 100,
      },
    );

    expect(result.sessionSummary).toMatchObject({
      goal: "Build feature X (phase 2)",
      keyDecisions: ["Chose approach A", "Used library B", "Switched to strategy C"],
      impactScope: ["auth module", "payments module"],
      updatedAt: 100,
    });
  });

  it("preserves existing keyDecisions when incoming is empty", () => {
    const result = applySessionSummaryUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        sessionSummary: {
          goal: "Old goal",
          keyDecisions: ["Decision 1"],
          updatedAt: 50,
        },
      },
      {
        goal: "New goal",
        now: 100,
      },
    );

    expect(result.sessionSummary?.keyDecisions).toEqual(["Decision 1"]);
  });

  it("replaces openQuestions on each update (not appended)", () => {
    const result = applySessionSummaryUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        sessionSummary: {
          goal: "Old goal",
          openQuestions: ["Old question?"],
          updatedAt: 50,
        },
      },
      {
        goal: "New goal",
        openQuestions: ["New question?"],
        now: 100,
      },
    );

    expect(result.sessionSummary?.openQuestions).toEqual(["New question?"]);
  });

  it("writes summary into the active list when progress has lists", () => {
    const result = applySessionSummaryUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        progress: {
          lists: [
            {
              id: "list-1",
              todos: [],
              startedAt: 1,
              updatedAt: 1,
            },
            {
              id: "list-2",
              todos: [],
              startedAt: 2,
              updatedAt: 2,
            },
          ],
          currentListId: "list-2",
          updatedAt: 2,
        },
      } as Metadata,
      {
        goal: "Ship feature X",
        currentFocus: "Wiring up the API",
        keyDecisions: ["Used REST over gRPC"],
        now: 100,
      },
    );

    const list1 = result.progress?.lists?.find((l) => l.id === "list-1");
    const list2 = result.progress?.lists?.find((l) => l.id === "list-2");
    expect(list1?.summary).toBeUndefined();
    expect(list2?.summary).toMatchObject({
      goal: "Ship feature X",
      currentFocus: "Wiring up the API",
      keyDecisions: ["Used REST over gRPC"],
      updatedAt: 100,
    });
  });

  it("appends keyDecisions into existing list summary without duplicates", () => {
    const result = applySessionSummaryUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        progress: {
          lists: [
            {
              id: "list-1",
              todos: [],
              startedAt: 1,
              updatedAt: 1,
              summary: {
                goal: "Old goal",
                keyDecisions: ["Decision A"],
                updatedAt: 50,
              },
            },
          ],
          currentListId: "list-1",
          updatedAt: 1,
        },
      } as Metadata,
      {
        goal: "New goal",
        keyDecisions: ["Decision A", "Decision B"],
        now: 100,
      },
    );

    const list1 = result.progress?.lists?.find((l) => l.id === "list-1");
    expect(list1?.summary?.keyDecisions).toEqual(["Decision A", "Decision B"]);
  });

  it("skips list summary update when no progress lists exist", () => {
    const result = applySessionSummaryUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
      },
      {
        goal: "A goal",
        now: 100,
      },
    );

    expect(result.progress).toBeUndefined();
    expect(result.sessionSummary?.goal).toBe("A goal");
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
