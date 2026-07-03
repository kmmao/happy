/**
 * SessionController protocol invariants (see CONTEXT.md "SessionController").
 *
 * Three invariants are pinned:
 *   1. queue-paused ↔ retry-dispatcher coupling — every explicit user send
 *      atom schedules the dispatcher with ignorePaused: true, and only after
 *      the interrupt settles (including on interrupt FAILURE).
 *   2. manual-send ↔ AutoOptionSend turn-dedup reset — the popover path
 *      records feedback then invalidates the candidate BEFORE enqueueing;
 *      the composer path records but deliberately does not invalidate.
 *   3. per-session subscription cleanup — an unsubscribed listener never
 *      fires again (adaptStorage passes Zustand's unsubscribe through).
 */

import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { createSessionController, type SessionControllerDeps } from "./sessionController";
import { adaptStorage, type PendingQueueItem } from "./sessionStorageOps";

const SID = "session-1";

function makeFakes(overrides?: {
    interruptSession?: SessionControllerDeps["interruptSession"];
    updateOk?: boolean;
}) {
    const calls: string[] = [];
    let localIdCounter = 0;
    const deps: SessionControllerDeps = {
        dispatcher: {
            schedule: vi.fn((sessionId: string, options?: { ignorePaused?: boolean }) => {
                calls.push(`schedule:${sessionId}:${options?.ignorePaused ? "ignorePaused" : "respectPaused"}`);
            }),
        },
        autoOption: {
            recordManualSend: vi.fn((...args: unknown[]) => {
                calls.push(`recordManualSend:${args[1]}`);
            }),
            dispatch: vi.fn((_sid, event) => {
                calls.push(`autoDispatch:${event.type}:${event.reason}`);
            }),
        },
        storage: {
            subscribe: vi.fn(() => () => {}),
            getQueue: vi.fn(() => []),
            getPaused: vi.fn(() => true), // queue is PAUSED in every test
            getSession: vi.fn(() => null),
            appendToPendingQueue: vi.fn((_sid, item: PendingQueueItem) => {
                calls.push(`append:${item.message}`);
            }),
            updatePendingQueueItem: vi.fn(() => {
                calls.push("update");
                return overrides?.updateOk ?? true;
            }),
            reorderPendingQueueItemToFront: vi.fn((_sid, localId: string) => {
                calls.push(`reorder:${localId}`);
            }),
            removePendingQueueItem: vi.fn(),
            clearPendingQueue: vi.fn(),
            setPendingQueuePaused: vi.fn(),
            updateSessionPermissionMode: vi.fn(),
            updateSessionModelMode: vi.fn(),
        },
        interruptSession:
            overrides?.interruptSession ??
            vi.fn(() => {
                calls.push("interrupt");
                return Promise.resolve();
            }),
        trackMessageSent: vi.fn(() => calls.push("track")),
        generateLocalId: () => `local-${++localIdCounter}`,
    };
    const controller = createSessionController({ deps, sessionId: SID });
    return { deps, controller, calls };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("invariant 1 — queue-paused ↔ dispatcher coupling", () => {
    it("sendHeadNow interrupts first, then schedules with ignorePaused on a paused queue", async () => {
        const { controller, deps, calls } = makeFakes();
        controller.sendHeadNow();
        await flush();
        expect(calls).toEqual(["interrupt", `schedule:${SID}:ignorePaused`]);
        expect(deps.dispatcher.schedule).toHaveBeenCalledTimes(1);
    });

    it("schedules EVEN WHEN the interrupt rejects — the drain must not be lost", async () => {
        const { controller, deps } = makeFakes({
            interruptSession: vi.fn(() => Promise.reject(new Error("socket down"))),
        });
        controller.interruptAndDispatch();
        await flush();
        expect(deps.dispatcher.schedule).toHaveBeenCalledWith(SID, { ignorePaused: true });
    });

    it("sendItemNow reorders to front before the interrupt/dispatch", async () => {
        const { controller, calls } = makeFakes();
        controller.sendItemNow("item-7");
        await flush();
        expect(calls).toEqual(["reorder:item-7", "interrupt", `schedule:${SID}:ignorePaused`]);
    });

    it("editSaveAndSendImmediately: update → reorder → interrupt → dispatch; returns true", async () => {
        const { controller, calls } = makeFakes();
        expect(controller.editSaveAndSendImmediately("item-3", "new text", undefined)).toBe(true);
        await flush();
        expect(calls).toEqual(["update", "reorder:item-3", "interrupt", `schedule:${SID}:ignorePaused`]);
    });

    it("editSaveAndSendImmediately bails out (false) when the item already drained — no dispatch", async () => {
        const { controller, deps, calls } = makeFakes({ updateOk: false });
        expect(controller.editSaveAndSendImmediately("gone", "text", undefined)).toBe(false);
        await flush();
        expect(calls).toEqual(["update"]);
        expect(deps.dispatcher.schedule).not.toHaveBeenCalled();
    });
});

describe("invariant 2 — manual-send ↔ AutoOptionSend turn-dedup reset", () => {
    it("popover send: record → invalidate(manual-send) → enqueue → track, in that order", () => {
        const { controller, calls } = makeFakes();
        controller.sendOptionFromPopover("Fix the tests", "hash-1");
        expect(calls).toEqual([
            "recordManualSend:Fix the tests",
            "autoDispatch:context-invalidated:manual-send",
            "append:Fix the tests",
            "track",
        ]);
    });

    it("composer send with a selected option records feedback but does NOT invalidate", () => {
        const { controller, deps, calls } = makeFakes();
        controller.sendComposerMessage({
            finalMessage: "Fix the tests, and also lint",
            selectedOption: { text: "Fix the tests", optionsHash: "hash-1", edited: true },
        });
        expect(deps.autoOption.recordManualSend).toHaveBeenCalledWith(
            SID, "Fix the tests", "hash-1", true, "manual",
        );
        expect(deps.autoOption.dispatch).not.toHaveBeenCalled();
        expect(calls).toContain("append:Fix the tests, and also lint");
    });

    it("composer send without an option touches AutoOptionSend not at all", () => {
        const { controller, deps } = makeFakes();
        controller.sendComposerMessage({ finalMessage: "hello" });
        expect(deps.autoOption.recordManualSend).not.toHaveBeenCalled();
        expect(deps.autoOption.dispatch).not.toHaveBeenCalled();
    });

    it("chainAfter enqueues the follow-up right behind the main message", () => {
        const { controller, calls } = makeFakes();
        const { localId } = controller.sendComposerMessage({
            finalMessage: "/clear",
            chainAfter: "/caveman",
        });
        expect(localId).toBe("local-1");
        expect(calls).toEqual(["append:/clear", "append:/caveman", "track"]);
    });
});

describe("invariant 3 — per-session subscription cleanup", () => {
    it("adaptStorage passes unsubscribe through — a removed listener never fires again", () => {
        type QueueState = {
            sessionPendingQueues: Record<string, PendingQueueItem[]>;
            sessionPendingQueuePaused: Record<string, boolean>;
            sessions: Record<string, never>;
            bump(sessionId: string): void;
        };
        const store = createStore<QueueState>((set) => ({
            sessionPendingQueues: {},
            sessionPendingQueuePaused: {},
            sessions: {},
            bump: (sessionId: string) =>
                set((prev) => ({
                    sessionPendingQueues: {
                        ...prev.sessionPendingQueues,
                        [sessionId]: [
                            ...(prev.sessionPendingQueues[sessionId] ?? []),
                            { localId: "x", message: "m" },
                        ],
                    },
                })),
        }));
        const ops = adaptStorage({
            subscribe: (cb) => store.subscribe(cb),
            getState: () => store.getState() as never,
        });

        const listener = vi.fn();
        const unsubscribe = ops.subscribe(listener);

        store.getState().bump(SID);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(ops.getQueue(SID)).toHaveLength(1);

        unsubscribe();
        store.getState().bump(SID);
        expect(listener).toHaveBeenCalledTimes(1); // did not fire again
    });

    it("getQueue/getPaused fall back to stable empties for unknown sessions", () => {
        const store = createStore(() => ({
            sessionPendingQueues: {},
            sessionPendingQueuePaused: {},
            sessions: {},
        }));
        const ops = adaptStorage({
            subscribe: (cb) => store.subscribe(cb),
            getState: () => store.getState() as never,
        });
        expect(ops.getQueue("unknown")).toEqual([]);
        // Stable reference — useSyncExternalStore must not see a fresh [] per call.
        expect(ops.getQueue("unknown")).toBe(ops.getQueue("unknown"));
        expect(ops.getPaused("unknown")).toBe(false);
    });
});
