import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn<(
  sessionId: string,
  text: string,
  displayText?: string,
  options?: { localId?: string; bypassRunningCheck?: boolean },
) => Promise<boolean | void>>();

const storageState = {
  sessions: {} as Record<string, { sdkSessionState?: string; active?: boolean; thinking?: boolean }>,
  sessionPendingQueues: {} as Record<string, Array<{ localId: string; message: string; displayText?: string }>>,
  sessionPendingQueuePaused: {} as Record<string, boolean>,
  shiftPendingQueue: vi.fn((sessionId: string) => {
    const queue = storageState.sessionPendingQueues[sessionId];
    if (!queue || queue.length === 0) return undefined;
    const [first, ...rest] = queue;
    storageState.sessionPendingQueues = {
      ...storageState.sessionPendingQueues,
      [sessionId]: rest,
    };
    return first;
  }),
  appendToPendingQueue: vi.fn((sessionId: string, item: { localId: string; message: string; displayText?: string }) => {
    storageState.sessionPendingQueues = {
      ...storageState.sessionPendingQueues,
      [sessionId]: [...(storageState.sessionPendingQueues[sessionId] ?? []), item],
    };
  }),
  reorderPendingQueueItemToFront: vi.fn((sessionId: string, localId: string) => {
    const queue = storageState.sessionPendingQueues[sessionId];
    if (!queue) return;
    const idx = queue.findIndex((item) => item.localId === localId);
    if (idx <= 0) return;
    const item = queue[idx]!;
    storageState.sessionPendingQueues = {
      ...storageState.sessionPendingQueues,
      [sessionId]: [item, ...queue.slice(0, idx), ...queue.slice(idx + 1)],
    };
  }),
};

vi.mock("@/sync/storage", () => ({
  storage: {
    getState: () => storageState,
  },
}));

vi.mock("@/log", () => ({
  log: {
    error: vi.fn(),
  },
}));

vi.mock("@/utils/sessionUtils", () => ({
  isSessionRunning: (session: { sdkSessionState?: string; thinking?: boolean }) =>
    session.sdkSessionState != null
      ? session.sdkSessionState === "running"
      : session.thinking === true,
}));

describe("PendingQueueDispatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendMessage.mockResolvedValue(true);
    storageState.sessions = {
      "session-1": { sdkSessionState: "idle", active: true, thinking: false },
    };
    storageState.sessionPendingQueues = {};
    storageState.sessionPendingQueuePaused = {};
    storageState.shiftPendingQueue.mockClear();
    storageState.appendToPendingQueue.mockClear();
    storageState.reorderPendingQueueItemToFront.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not send while the session is running", async () => {
    const { PendingQueueDispatcher } = await import("./pendingQueueDispatcher");
    const dispatcher = new PendingQueueDispatcher();
    dispatcher.init(sendMessage);
    storageState.sessions["session-1"] = { sdkSessionState: "running", active: true };
    storageState.sessionPendingQueues = {
      "session-1": [{ localId: "local-1", message: "second" }],
    };

    dispatcher.schedule("session-1");
    await vi.runOnlyPendingTimersAsync();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(storageState.sessionPendingQueues["session-1"]).toHaveLength(1);
  });

  it("sends the first queued message when the session is idle without SessionView", async () => {
    const { PendingQueueDispatcher } = await import("./pendingQueueDispatcher");
    const dispatcher = new PendingQueueDispatcher();
    dispatcher.init(sendMessage);
    storageState.sessionPendingQueues = {
      "session-1": [{ localId: "local-1", message: "queued", displayText: "Queued" }],
    };

    dispatcher.schedule("session-1");
    await vi.runOnlyPendingTimersAsync();

    expect(sendMessage).toHaveBeenCalledWith(
      "session-1",
      "queued",
      "Queued",
      { localId: "local-1", bypassRunningCheck: true },
    );
    expect(storageState.sessionPendingQueues["session-1"]).toHaveLength(0);
  });

  it("respects paused queues until explicitly forced", async () => {
    const { PendingQueueDispatcher } = await import("./pendingQueueDispatcher");
    const dispatcher = new PendingQueueDispatcher();
    dispatcher.init(sendMessage);
    storageState.sessionPendingQueuePaused = { "session-1": true };
    storageState.sessionPendingQueues = {
      "session-1": [{ localId: "local-1", message: "queued" }],
    };

    dispatcher.schedule("session-1");
    await vi.runOnlyPendingTimersAsync();
    expect(sendMessage).not.toHaveBeenCalled();

    dispatcher.schedule("session-1", { ignorePaused: true });
    await vi.runOnlyPendingTimersAsync();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("restores the item when sendMessage returns false without immediately retrying", async () => {
    const { PendingQueueDispatcher } = await import("./pendingQueueDispatcher");
    const dispatcher = new PendingQueueDispatcher();
    dispatcher.init(sendMessage);
    sendMessage.mockResolvedValue(false);
    storageState.sessionPendingQueues = {
      "session-1": [
        { localId: "local-1", message: "first" },
        { localId: "local-2", message: "second" },
      ],
    };

    dispatcher.schedule("session-1");
    await vi.runOnlyPendingTimersAsync();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(storageState.sessionPendingQueues["session-1"]?.map((item) => item.localId)).toEqual([
      "local-1",
      "local-2",
    ]);
  });

  it("releases the gate after fallback so another schedule can send the next item", async () => {
    const { PendingQueueDispatcher } = await import("./pendingQueueDispatcher");
    const dispatcher = new PendingQueueDispatcher();
    dispatcher.init(sendMessage);
    storageState.sessionPendingQueues = {
      "session-1": [
        { localId: "local-1", message: "first" },
        { localId: "local-2", message: "second" },
      ],
    };

    dispatcher.schedule("session-1");
    await vi.runOnlyPendingTimersAsync();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.runOnlyPendingTimersAsync();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]?.[3]).toEqual({
      localId: "local-2",
      bypassRunningCheck: true,
    });
  });

  it("keeps a forced paused send forced when a plain schedule happens before dispatch", async () => {
    const { PendingQueueDispatcher } = await import("./pendingQueueDispatcher");
    const dispatcher = new PendingQueueDispatcher();
    dispatcher.init(sendMessage);
    storageState.sessionPendingQueuePaused = { "session-1": true };
    storageState.sessionPendingQueues = {
      "session-1": [{ localId: "local-1", message: "queued" }],
    };

    dispatcher.schedule("session-1", { ignorePaused: true });
    dispatcher.schedule("session-1");
    await vi.runOnlyPendingTimersAsync();

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not keep bypassing pause after a forced send fails", async () => {
    const { PendingQueueDispatcher } = await import("./pendingQueueDispatcher");
    const dispatcher = new PendingQueueDispatcher();
    dispatcher.init(sendMessage);
    sendMessage.mockResolvedValue(false);
    storageState.sessionPendingQueuePaused = { "session-1": true };
    storageState.sessionPendingQueues = {
      "session-1": [
        { localId: "local-1", message: "first" },
        { localId: "local-2", message: "second" },
      ],
    };

    dispatcher.schedule("session-1", { ignorePaused: true });
    await vi.runOnlyPendingTimersAsync();
    dispatcher.schedule("session-1");
    await vi.runOnlyPendingTimersAsync();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(storageState.sessionPendingQueues["session-1"]?.map((item) => item.localId)).toEqual([
      "local-1",
      "local-2",
    ]);
  });
});
