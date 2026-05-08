import React from "react";
import { create, act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  updateFaviconWithNotificationMock: vi.fn(),
  resetFaviconMock: vi.fn(),
  storageMock: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
}));

vi.mock("@/sync/storage", () => ({
  storage: (selector: (state: unknown) => unknown) => mocks.storageMock(selector),
}));

vi.mock("@/utils/web/faviconGenerator", () => ({
  updateFaviconWithNotification: mocks.updateFaviconWithNotificationMock,
  resetFavicon: mocks.resetFaviconMock,
}));

import { FaviconPermissionIndicator } from "./FaviconPermissionIndicator";

describe("FaviconPermissionIndicator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const globals = globalThis as unknown as { window?: Window; document?: Document };
    globals.window = {} as Window;
    globals.document = {} as Document;
  });

  it("does not crash when a session has null agentState.requests", () => {
    mocks.storageMock.mockImplementation((selector) =>
      selector({
        sessions: {
          "session-1": {
            presence: "online",
            agentState: {
              requests: null,
            },
          },
        },
      }),
    );

    expect(() => {
      act(() => {
        create(React.createElement(FaviconPermissionIndicator));
      });
    }).not.toThrow();

    expect(mocks.updateFaviconWithNotificationMock).not.toHaveBeenCalled();
    expect(mocks.resetFaviconMock).toHaveBeenCalled();
  });
});
