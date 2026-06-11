import { describe, expect, it, vi } from "vitest";
import { createIngestEventDispatcher, ingestEvents } from "./dispatcher";
import type { IngestEvent } from "./types";

const sessionsStale: IngestEvent = { kind: "sessions-stale" };
const machinesStale: IngestEvent = { kind: "machines-stale" };
const sessionDeleted: IngestEvent = { kind: "session-deleted", sid: "s1" };

describe("IngestEventDispatcher", () => {
    it("delivers an emitted event to a subscriber on the same kind", () => {
        const d = createIngestEventDispatcher();
        const listener = vi.fn();
        d.on("sessions-stale", listener);

        d.emit([sessionsStale]);

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(sessionsStale);
    });

    it("does NOT deliver an event to subscribers of a different kind", () => {
        const d = createIngestEventDispatcher();
        const sessions = vi.fn();
        const machines = vi.fn();
        d.on("sessions-stale", sessions);
        d.on("machines-stale", machines);

        d.emit([sessionsStale]);

        expect(sessions).toHaveBeenCalledTimes(1);
        expect(machines).not.toHaveBeenCalled();
    });

    it("delivers each event in a batch to all matching subscribers", () => {
        const d = createIngestEventDispatcher();
        const sessions = vi.fn();
        const machines = vi.fn();
        d.on("sessions-stale", sessions);
        d.on("machines-stale", machines);

        d.emit([sessionsStale, machinesStale, sessionsStale]);

        expect(sessions).toHaveBeenCalledTimes(2);
        expect(machines).toHaveBeenCalledTimes(1);
    });

    it("invokes multiple subscribers on the same kind in registration order", () => {
        const d = createIngestEventDispatcher();
        const order: number[] = [];
        d.on("sessions-stale", () => order.push(1));
        d.on("sessions-stale", () => order.push(2));
        d.on("sessions-stale", () => order.push(3));

        d.emit([sessionsStale]);

        expect(order).toEqual([1, 2, 3]);
    });

    it("returns an unsubscribe function that removes the listener", () => {
        const d = createIngestEventDispatcher();
        const listener = vi.fn();
        const unsub = d.on("sessions-stale", listener);

        d.emit([sessionsStale]);
        expect(listener).toHaveBeenCalledTimes(1);

        unsub();
        d.emit([sessionsStale]);
        expect(listener).toHaveBeenCalledTimes(1); // not called again
    });

    it("unsubscribe is idempotent", () => {
        const d = createIngestEventDispatcher();
        const listener = vi.fn();
        const unsub = d.on("sessions-stale", listener);
        unsub();
        expect(() => unsub()).not.toThrow();
        d.emit([sessionsStale]);
        expect(listener).not.toHaveBeenCalled();
    });

    it("isolates a throwing subscriber so the rest of the batch still fires", () => {
        const d = createIngestEventDispatcher();
        const order: string[] = [];
        d.on("sessions-stale", () => {
            order.push("before");
            throw new Error("boom");
        });
        d.on("sessions-stale", () => order.push("after"));
        d.on("machines-stale", () => order.push("machines"));

        d.emit([sessionsStale, machinesStale]);

        // throwing subscriber recorded its push; subsequent subscriber on the
        // same kind ran; the next event in the batch dispatched normally.
        expect(order).toEqual(["before", "after", "machines"]);
    });

    it("passes the typed event payload to discriminated listeners", () => {
        const d = createIngestEventDispatcher();
        const captured: { kind: string; sid: string }[] = [];
        d.on("session-deleted", (event) => {
            // TS narrows event to { kind: "session-deleted"; sid: string }
            captured.push({ kind: event.kind, sid: event.sid });
        });

        d.emit([sessionDeleted]);

        expect(captured).toEqual([{ kind: "session-deleted", sid: "s1" }]);
    });

    it("emitting with no subscribers is a no-op", () => {
        const d = createIngestEventDispatcher();
        expect(() => d.emit([sessionsStale, machinesStale])).not.toThrow();
    });

    it("emitting an empty batch is a no-op", () => {
        const d = createIngestEventDispatcher();
        const listener = vi.fn();
        d.on("sessions-stale", listener);

        d.emit([]);

        expect(listener).not.toHaveBeenCalled();
    });

    it("createIngestEventDispatcher() yields isolated instances", () => {
        const a = createIngestEventDispatcher();
        const b = createIngestEventDispatcher();
        const aListener = vi.fn();
        const bListener = vi.fn();
        a.on("sessions-stale", aListener);
        b.on("sessions-stale", bListener);

        a.emit([sessionsStale]);

        expect(aListener).toHaveBeenCalledTimes(1);
        expect(bListener).not.toHaveBeenCalled();
    });

    it("a listener that unsubscribes itself mid-dispatch does not perturb other listeners", () => {
        const d = createIngestEventDispatcher();
        const order: number[] = [];
        let unsubSelf: (() => void) | null = null;
        d.on("sessions-stale", () => order.push(1));
        unsubSelf = d.on("sessions-stale", () => {
            order.push(2);
            unsubSelf?.();
        });
        d.on("sessions-stale", () => order.push(3));

        d.emit([sessionsStale]);
        // Snapshot iteration: all three listeners fire on this batch even though
        // listener #2 removed itself.
        expect(order).toEqual([1, 2, 3]);

        d.emit([sessionsStale]);
        // On the next batch, only #1 and #3 remain.
        expect(order).toEqual([1, 2, 3, 1, 3]);
    });

    it("the module-level `ingestEvents` singleton is a usable dispatcher", () => {
        const listener = vi.fn();
        const unsub = ingestEvents.on("sessions-stale", listener);
        try {
            ingestEvents.emit([sessionsStale]);
            expect(listener).toHaveBeenCalledTimes(1);
        } finally {
            unsub();
        }
    });
});
