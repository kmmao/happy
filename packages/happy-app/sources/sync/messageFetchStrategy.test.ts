import { describe, expect, it } from "vitest";

import {
  resolveMessageHistoryFetchStrategy,
  shouldApplyMessagesImmediately,
  shouldFetchNewestPageFirst,
} from "./messageFetchStrategy";

describe("messageFetchStrategy", () => {
  it("uses latest-only history fetch on web when no cursor exists", () => {
    const strategy = resolveMessageHistoryFetchStrategy({
      platformOS: "web",
      initialAfterSeq: 0,
    });

    expect(strategy).toBe("webLatestOnly");
    expect(shouldFetchNewestPageFirst(strategy)).toBe(true);
    expect(shouldApplyMessagesImmediately(strategy)).toBe(true);
  });

  it("uses full native history fetch when no cursor exists", () => {
    const strategy = resolveMessageHistoryFetchStrategy({
      platformOS: "ios",
      initialAfterSeq: 0,
    });

    expect(strategy).toBe("nativeFullHistory");
    expect(shouldFetchNewestPageFirst(strategy)).toBe(false);
    expect(shouldApplyMessagesImmediately(strategy)).toBe(false);
  });

  it("uses incremental fetch once a cursor exists on any platform", () => {
    expect(
      resolveMessageHistoryFetchStrategy({
        platformOS: "web",
        initialAfterSeq: 42,
      }),
    ).toBe("incremental");
    expect(
      resolveMessageHistoryFetchStrategy({
        platformOS: "android",
        initialAfterSeq: 42,
      }),
    ).toBe("incremental");
  });
});
