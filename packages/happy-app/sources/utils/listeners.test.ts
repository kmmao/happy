import { describe, expect, it, vi } from "vitest";

import { createListeners } from "./listeners";

describe("createListeners", () => {
    it("fans an emit out to every subscriber", () => {
        const listeners = createListeners<number>();
        const a = vi.fn();
        const b = vi.fn();
        listeners.subscribe(a);
        listeners.subscribe(b);

        listeners.emit(7);

        expect(a).toHaveBeenCalledWith(7);
        expect(b).toHaveBeenCalledWith(7);
    });

    it("the disposer removes exactly its own listener", () => {
        const listeners = createListeners<number>();
        const a = vi.fn();
        const b = vi.fn();
        const disposeA = listeners.subscribe(a);
        listeners.subscribe(b);

        disposeA();
        listeners.emit(1);

        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledWith(1);
    });

    it("without replay a late subscriber only sees future emits", () => {
        const listeners = createListeners<number>();
        listeners.emit(1);
        const late = vi.fn();

        listeners.subscribe(late);
        expect(late).not.toHaveBeenCalled();

        listeners.emit(2);
        expect(late).toHaveBeenCalledTimes(1);
        expect(late).toHaveBeenCalledWith(2);
    });

    it("with replay a subscriber is immediately called with the current value", () => {
        const listeners = createListeners<string>({ initial: "disconnected" });
        const first = vi.fn();

        listeners.subscribe(first);
        expect(first).toHaveBeenCalledWith("disconnected");

        listeners.emit("connected");

        // A later subscriber replays the latest emitted value, not the initial.
        const second = vi.fn();
        listeners.subscribe(second);
        expect(second).toHaveBeenCalledWith("connected");
    });

    it("emit iterates a snapshot: a listener unsubscribing mid-emit is safe", () => {
        const listeners = createListeners<number>();
        const order: string[] = [];
        let disposeSelf: (() => void) | null = null;

        disposeSelf = listeners.subscribe(() => {
            order.push("self");
            disposeSelf?.(); // remove itself during the emit
        });
        listeners.subscribe(() => order.push("other"));

        // Both still fire this round despite the mid-emit removal.
        listeners.emit(1);
        expect(order).toEqual(["self", "other"]);

        // Next round only the survivor fires.
        listeners.emit(2);
        expect(order).toEqual(["self", "other", "other"]);
    });

    it("a listener subscribing during emit is not called in the current round", () => {
        const listeners = createListeners<number>();
        const added = vi.fn();
        listeners.subscribe(() => {
            listeners.subscribe(added);
        });

        listeners.emit(1);
        expect(added).not.toHaveBeenCalled();

        listeners.emit(2);
        expect(added).toHaveBeenCalledTimes(1);
        expect(added).toHaveBeenCalledWith(2);
    });

    it("a void registry emits with no argument", () => {
        const listeners = createListeners();
        const a = vi.fn();
        listeners.subscribe(a);

        listeners.emit();

        expect(a).toHaveBeenCalledTimes(1);
    });
});
