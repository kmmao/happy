import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OlderMessagePrefetchDeps,
  prefetchOlderMessagesInBackground,
} from "./messagePrefetch";

type PageResult = { oldestSeq: number; hasMore: boolean };

/**
 * Builds prefetch deps backed by a tiny in-memory "server" model. Each
 * fetchOlderMessages call consumes the next scripted page and mutates the
 * oldest-seq cursor / hasMore flag, mirroring the real single-page pull.
 */
function buildDeps(opts: {
  initialOldestSeq: number | undefined;
  initialHasMore: boolean;
  pages: PageResult[];
  encryption?: boolean;
  sleepMs?: number;
}) {
  const state = {
    oldestSeq: opts.initialOldestSeq,
    hasMore: opts.initialHasMore,
    encryption: opts.encryption ?? true,
  };
  const queue: PageResult[] = [...opts.pages];

  const fetchOlderMessages = vi.fn(async (_sessionId: string) => {
    const next = queue.shift();
    if (next) {
      state.oldestSeq = next.oldestSeq;
      state.hasMore = next.hasMore;
    } else {
      // No more scripted pages — behave like the cursor reaching the start.
      state.hasMore = false;
    }
  });

  const deps: OlderMessagePrefetchDeps = {
    fetchOlderMessages,
    hasServerOlderMessages: () => state.hasMore,
    hasSessionEncryption: () => state.encryption,
    getOldestSeq: () => state.oldestSeq,
    activePrefetches: new Set<string>(),
    sleepMs: opts.sleepMs ?? 0,
  };

  return { deps, state, queue, fetchOlderMessages };
}

const SID = "session-1";

describe("prefetchOlderMessagesInBackground", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("逐页预取更早消息,直到服务端没有更早消息", async () => {
    const { deps, fetchOlderMessages } = buildDeps({
      initialOldestSeq: 100,
      initialHasMore: true,
      pages: [
        { oldestSeq: 50, hasMore: true },
        { oldestSeq: 10, hasMore: true },
        { oldestSeq: 1, hasMore: false },
      ],
    });

    await prefetchOlderMessagesInBackground(deps, SID);

    expect(fetchOlderMessages).toHaveBeenCalledTimes(3);
    expect(deps.activePrefetches.has(SID)).toBe(false);
  });

  it("游标到达起点(oldestSeq <= 1)时停止,即使服务端仍声称有更早消息", async () => {
    const { deps, fetchOlderMessages } = buildDeps({
      initialOldestSeq: 100,
      initialHasMore: true,
      pages: [
        { oldestSeq: 50, hasMore: true },
        { oldestSeq: 1, hasMore: true },
      ],
    });

    await prefetchOlderMessagesInBackground(deps, SID);

    // After the 2nd page lands at seq 1 the loop stops before issuing a 3rd request.
    expect(fetchOlderMessages).toHaveBeenCalledTimes(2);
  });

  it("hasServerOlderMessages 为 false 时不发起任何预取", async () => {
    const { deps, fetchOlderMessages } = buildDeps({
      initialOldestSeq: 100,
      initialHasMore: false,
      pages: [],
    });

    await prefetchOlderMessagesInBackground(deps, SID);

    expect(fetchOlderMessages).not.toHaveBeenCalled();
  });

  it("session encryption 不可用时停止预取", async () => {
    const { deps, fetchOlderMessages } = buildDeps({
      initialOldestSeq: 100,
      initialHasMore: true,
      encryption: false,
      pages: [{ oldestSeq: 50, hasMore: true }],
    });

    await prefetchOlderMessagesInBackground(deps, SID);

    expect(fetchOlderMessages).not.toHaveBeenCalled();
  });

  it("防重入:同一会话并发调用只运行一个循环", async () => {
    const { deps, fetchOlderMessages } = buildDeps({
      initialOldestSeq: 100,
      initialHasMore: true,
      pages: [
        { oldestSeq: 50, hasMore: true },
        { oldestSeq: 1, hasMore: false },
      ],
    });

    const first = prefetchOlderMessagesInBackground(deps, SID);
    // Invoked synchronously while the first loop holds the re-entrancy flag.
    const second = prefetchOlderMessagesInBackground(deps, SID);
    await Promise.all([first, second]);

    // Only the first loop ran its 2 pages; the second was a no-op.
    expect(fetchOlderMessages).toHaveBeenCalledTimes(2);
    expect(deps.activePrefetches.has(SID)).toBe(false);
  });

  it("循环结束后清除标记,允许会话再次触发预取", async () => {
    const { deps, state, queue, fetchOlderMessages } = buildDeps({
      initialOldestSeq: 100,
      initialHasMore: true,
      pages: [{ oldestSeq: 1, hasMore: false }],
    });

    await prefetchOlderMessagesInBackground(deps, SID);
    expect(fetchOlderMessages).toHaveBeenCalledTimes(1);
    expect(deps.activePrefetches.has(SID)).toBe(false);

    // New older messages appear; a fresh trigger must be able to run again.
    state.oldestSeq = 60;
    state.hasMore = true;
    queue.push({ oldestSeq: 1, hasMore: false });
    await prefetchOlderMessagesInBackground(deps, SID);

    expect(fetchOlderMessages).toHaveBeenCalledTimes(2);
  });

  it("页与页之间留出约 250ms 间隔", async () => {
    vi.useFakeTimers();
    const { deps, fetchOlderMessages } = buildDeps({
      initialOldestSeq: 100,
      initialHasMore: true,
      sleepMs: 250,
      pages: [
        { oldestSeq: 50, hasMore: true },
        { oldestSeq: 1, hasMore: false },
      ],
    });

    const loop = prefetchOlderMessagesInBackground(deps, SID);

    // First page is requested synchronously before any await.
    expect(fetchOlderMessages).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchOlderMessages).toHaveBeenCalledTimes(1);

    // The next page must not fire until the full 250ms gap elapses.
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchOlderMessages).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchOlderMessages).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(250);
    await loop;
    expect(deps.activePrefetches.has(SID)).toBe(false);
  });
});
