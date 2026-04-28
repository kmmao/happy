import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  onSessionVisibleMock: vi.fn(),
  getSyncMock: vi.fn(() => ({ invalidate: vi.fn() })),
}));

vi.mock("@/sync/sync", () => ({
  sync: {
    onSessionVisible: mocks.onSessionVisibleMock,
  },
}));

vi.mock("@/sync/gitStatusSync", () => ({
  gitStatusSync: {
    getSync: mocks.getSyncMock,
  },
}));

import { useSessionVisibleEffect } from "./useSessionVisibleEffect";

function Harness(props: { sessionId: string; realtimeStatus: string }) {
  useSessionVisibleEffect(props.sessionId);
  return null;
}

describe("useSessionVisibleEffect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("只在 sessionId 变化时触发会话可见性同步", () => {
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        React.createElement(Harness, {
          sessionId: "session-1",
          realtimeStatus: "disconnected",
        }),
      );
    });

    expect(mocks.onSessionVisibleMock).toHaveBeenCalledTimes(1);
    expect(mocks.onSessionVisibleMock).toHaveBeenCalledWith("session-1");
    expect(mocks.getSyncMock).toHaveBeenCalledTimes(1);
    expect(mocks.getSyncMock).toHaveBeenCalledWith("session-1");

    act(() => {
      renderer.update(
        React.createElement(Harness, {
          sessionId: "session-1",
          realtimeStatus: "connected",
        }),
      );
    });

    expect(mocks.onSessionVisibleMock).toHaveBeenCalledTimes(1);
    expect(mocks.getSyncMock).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.update(
        React.createElement(Harness, {
          sessionId: "session-2",
          realtimeStatus: "connected",
        }),
      );
    });

    expect(mocks.onSessionVisibleMock).toHaveBeenCalledTimes(2);
    expect(mocks.onSessionVisibleMock).toHaveBeenLastCalledWith("session-2");
    expect(mocks.getSyncMock).toHaveBeenCalledTimes(2);
    expect(mocks.getSyncMock).toHaveBeenLastCalledWith("session-2");

    act(() => {
      renderer.unmount();
    });
  });
});
