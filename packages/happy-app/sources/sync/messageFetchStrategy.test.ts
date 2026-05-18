import { describe, expect, it } from "vitest";

import {
  resolveMessageHistoryFetchStrategy,
  shouldApplyMessagesImmediately,
  shouldFetchNewestPageFirst,
} from "./messageFetchStrategy";

describe("messageFetchStrategy", () => {
  it("uses full history fetch when no cursor exists", () => {
    const strategy = resolveMessageHistoryFetchStrategy({
      initialAfterSeq: 0,
    });

    expect(strategy).toBe("fullHistory");
    expect(shouldFetchNewestPageFirst(strategy)).toBe(false);
    expect(shouldApplyMessagesImmediately(strategy)).toBe(true);
  });

  it("uses incremental fetch once a cursor exists", () => {
    expect(
      resolveMessageHistoryFetchStrategy({
        initialAfterSeq: 42,
      }),
    ).toBe("incremental");
    expect(
      resolveMessageHistoryFetchStrategy({
        initialAfterSeq: 1,
      }),
    ).toBe("incremental");
  });
});
