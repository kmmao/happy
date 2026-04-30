import { describe, expect, it } from "vitest";

import { resolveMessageCursorAdvance } from "./messageCursor";

describe("resolveMessageCursorAdvance", () => {
  it("只推进到连续成功处理的消息，避免跳过解密失败的 seq", () => {
    expect(
      resolveMessageCursorAdvance({
        afterSeq: 10,
        rawSeqs: [11, 12, 13],
        processedSeqs: [11, 13],
      }),
    ).toEqual({
      nextAfterSeq: 11,
      cursorSeq: 11,
      stalled: false,
      blockedByUnprocessedSeq: true,
    });
  });

  it("第一条消息未处理成功时不前进游标", () => {
    expect(
      resolveMessageCursorAdvance({
        afterSeq: 10,
        rawSeqs: [11, 12, 13],
        processedSeqs: [12, 13],
      }),
    ).toEqual({
      nextAfterSeq: 10,
      cursorSeq: null,
      stalled: true,
      blockedByUnprocessedSeq: true,
    });
  });

  it("全部消息都成功处理时推进到最后一个 seq", () => {
    expect(
      resolveMessageCursorAdvance({
        afterSeq: 10,
        rawSeqs: [11, 12, 13],
        processedSeqs: [11, 12, 13],
      }),
    ).toEqual({
      nextAfterSeq: 13,
      cursorSeq: 13,
      stalled: false,
      blockedByUnprocessedSeq: false,
    });
  });

  it("空页标记 stalled 并前进一个 seq", () => {
    expect(
      resolveMessageCursorAdvance({
        afterSeq: 10,
        rawSeqs: [],
        processedSeqs: [],
      }),
    ).toEqual({
      nextAfterSeq: 11,
      cursorSeq: null,
      stalled: true,
      blockedByUnprocessedSeq: false,
    });
  });
});
