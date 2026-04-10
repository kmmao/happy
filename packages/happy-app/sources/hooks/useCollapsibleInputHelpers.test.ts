import { describe, expect, it } from "vitest";
import {
  didPendingActionAppear,
  getHasPendingAction,
} from "./useCollapsibleInputHelpers";

describe("useCollapsibleInput helpers", () => {
  it("将 requires_action 视为 pending action", () => {
    expect(
      getHasPendingAction({
        promptSuggestion: null,
        needsContinue: false,
        requiresAction: true,
      }),
    ).toBe(true);
  });

  it("requires_action 出现时应触发自动展开", () => {
    expect(
      didPendingActionAppear(
        {
          promptSuggestion: null,
          needsContinue: false,
          requiresAction: false,
        },
        {
          promptSuggestion: null,
          needsContinue: false,
          requiresAction: true,
        },
      ),
    ).toBe(true);
  });

  it("已有其他 pending action 时切到 requires_action 不重复触发展开", () => {
    expect(
      didPendingActionAppear(
        {
          promptSuggestion: "继续",
          needsContinue: false,
          requiresAction: false,
        },
        {
          promptSuggestion: "继续",
          needsContinue: false,
          requiresAction: true,
        },
      ),
    ).toBe(false);
  });
});
