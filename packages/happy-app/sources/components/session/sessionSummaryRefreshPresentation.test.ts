import { describe, expect, it } from "vitest";

import {
  buildSessionSummaryRefreshDebugText,
  formatSummaryRefreshRequestIdPreview,
  resolveSessionSummaryRefreshDebugState,
} from "./sessionSummaryRefreshPresentation";

describe("resolveSessionSummaryRefreshDebugState", () => {
  it("returns null when no active or recent protocol state exists", () => {
    expect(
      resolveSessionSummaryRefreshDebugState({
        protocolVersion: 1,
        recent: [],
      }),
    ).toBeNull();
    expect(resolveSessionSummaryRefreshDebugState(undefined)).toBeNull();
  });

  it("prefers the active request when a refresh is pending", () => {
    const result = resolveSessionSummaryRefreshDebugState({
      protocolVersion: 1,
      active: {
        requestId: "summary-refresh_1234567890",
        requestedAt: 100,
        requester: "happy-agent",
        command: "summary-refresh",
        requireSummary: true,
      },
      recent: [
        {
          requestId: "summary-refresh_old",
          status: "applied",
          resolvedAt: 50,
          summaryUpdatedAt: 50,
        },
      ],
    });

    expect(result).toEqual({
      kind: "pending",
      protocolVersion: 1,
      requestId: "summary-refresh_1234567890",
      requestIdPreview: "summary-refresh_1…567890",
      timestamp: 100,
      requireSummary: true,
    });
  });

  it("returns the latest applied recent entry when no active request exists", () => {
    const result = resolveSessionSummaryRefreshDebugState({
      protocolVersion: 1,
      recent: [
        {
          requestId: "summary-refresh_1",
          status: "applied",
          resolvedAt: 10,
          summaryUpdatedAt: 10,
        },
        {
          requestId: "summary-refresh_2",
          status: "applied",
          resolvedAt: 20,
          summaryUpdatedAt: 20,
        },
      ],
    });

    expect(result).toEqual({
      kind: "applied",
      protocolVersion: 1,
      requestId: "summary-refresh_2",
      requestIdPreview: "summary-refresh_2",
      timestamp: 20,
      summaryUpdatedAt: 20,
    });
  });

  it("returns the latest superseded recent entry", () => {
    const result = resolveSessionSummaryRefreshDebugState({
      protocolVersion: 1,
      recent: [
        {
          requestId: "summary-refresh_old",
          status: "superseded",
          resolvedAt: 30,
          supersededByRequestId: "summary-refresh_new",
        },
      ],
    });

    expect(result).toEqual({
      kind: "superseded",
      protocolVersion: 1,
      requestId: "summary-refresh_old",
      requestIdPreview: "summary-refresh_old",
      timestamp: 30,
      supersededByRequestId: "summary-refresh_new",
      supersededByRequestIdPreview: "summary-refresh_new",
    });
  });
});

describe("formatSummaryRefreshRequestIdPreview", () => {
  it("shortens long request ids for debug UI", () => {
    expect(
      formatSummaryRefreshRequestIdPreview(
        "summary-refresh_1234567890abcdefghijklmnop",
      ),
    ).toBe("summary-refresh_1…klmnop");
  });
});

describe("buildSessionSummaryRefreshDebugText", () => {
  const pending = (params: Record<string, unknown>) =>
    `pending:${JSON.stringify(params)}`;
  const applied = (params: Record<string, unknown>) =>
    `applied:${JSON.stringify(params)}`;
  const superseded = (params: Record<string, unknown>) =>
    `superseded:${JSON.stringify(params)}`;

  it("builds translated pending/applied/superseded debug text", () => {
    expect(
      buildSessionSummaryRefreshDebugText(
        {
          kind: "pending",
          protocolVersion: 1,
          requestId: "r1",
          requestIdPreview: "r1",
          timestamp: 1,
          requireSummary: true,
        },
        { relativeTimeLabel: "just now", pending, applied, superseded },
      ),
    ).toBe('pending:{"requestId":"r1","time":"just now"}');

    expect(
      buildSessionSummaryRefreshDebugText(
        {
          kind: "applied",
          protocolVersion: 1,
          requestId: "r2",
          requestIdPreview: "r2",
          timestamp: 2,
        },
        { relativeTimeLabel: "1m ago", pending, applied, superseded },
      ),
    ).toBe('applied:{"requestId":"r2","time":"1m ago"}');

    expect(
      buildSessionSummaryRefreshDebugText(
        {
          kind: "superseded",
          protocolVersion: 1,
          requestId: "r3",
          requestIdPreview: "r3",
          timestamp: 3,
        },
        { relativeTimeLabel: "2m ago", pending, applied, superseded },
      ),
    ).toBe('superseded:{"requestId":"r3","time":"2m ago"}');
  });
});
