/**
 * Lightweight event bus for cross-tab communication within project detail view.
 * Allows health tab and actions tab to notify each other of data changes.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export function emitProjectEvent(event: string): void {
    const set = listeners.get(event);
    if (set) {
        for (const fn of set) {
            fn();
        }
    }
}

export function onProjectEvent(event: string, listener: Listener): () => void {
    let set = listeners.get(event);
    if (!set) {
        set = new Set();
        listeners.set(event, set);
    }
    set.add(listener);
    return () => {
        set!.delete(listener);
        if (set!.size === 0) {
            listeners.delete(event);
        }
    };
}
