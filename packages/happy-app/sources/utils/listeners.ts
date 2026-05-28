/**
 * A fan-out listener registry: many subscribers, one `emit`.
 *
 * This concentrates the subscribe → return-disposer → fan-out dance that the
 * realtime layer otherwise hand-rolls once per event kind (apiSocket alone had
 * three near-identical `Set<(value) => void>` copies). Two invariants that the
 * raw `Set.forEach` versions kept getting subtly wrong live here, behind a
 * two-method interface:
 *
 *  - **emit iterates a snapshot** of the listeners, so a listener that
 *    subscribes or unsubscribes *during* an emit is neither skipped for the
 *    current round nor invoked twice — a live `Set.forEach` gives no such
 *    guarantee.
 *  - **replay (opt-in)** — when created with an `initial` value the registry
 *    remembers the last emitted value and immediately calls a late subscriber
 *    with it, so the subscriber learns the current state without waiting for the
 *    next change. This is exactly what a connection-status listener needs.
 *
 * `T = void` registries (no payload) call `emit()` with no argument.
 */
export interface Listeners<T> {
    /** Register `listener`; returns a disposer that removes exactly it. */
    subscribe(listener: (value: T) => void): () => void;
    /** Fan `value` out to every current subscriber (snapshot-safe). */
    emit(value: T): void;
}

export function createListeners<T = void>(
    options?: { initial: T },
): Listeners<T> {
    const listeners = new Set<(value: T) => void>();
    // Presence of `last` doubles as the "replay enabled" flag; it tracks the
    // most recently emitted value once replay is on.
    let last: { value: T } | undefined = options
        ? { value: options.initial }
        : undefined;

    const subscribe = (listener: (value: T) => void): () => void => {
        listeners.add(listener);
        if (last) {
            listener(last.value);
        }
        return () => {
            listeners.delete(listener);
        };
    };

    const emit = (value: T): void => {
        if (last) {
            last = { value };
        }
        // Snapshot so a subscribe/unsubscribe during emit is safe.
        for (const listener of [...listeners]) {
            listener(value);
        }
    };

    return { subscribe, emit };
}
