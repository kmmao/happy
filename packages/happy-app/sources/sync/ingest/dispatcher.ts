/**
 * IngestEventDispatcher: fans typed {@link IngestEvent} values from the
 * SyncUpdateIngest / SyncEphemeralIngest seams to registered subscribers
 * (voice cues, notifications, sync invalidations, issue-session bookkeeping,
 * git status invalidation, …).
 *
 * Per ADR-0026 Decisions A + D + E:
 *   - subscribers are typed-by-kind (TS narrows the event payload);
 *   - subscribers fire in registration order;
 *   - a subscriber that throws is caught + logged so subsequent subscribers
 *     and subsequent events in the same batch still fire;
 *   - the production instance is a module-level singleton (`ingestEvents`);
 *     tests that need isolation construct their own with
 *     {@link createIngestEventDispatcher}.
 */

import { log } from "@/log";
import type { IngestEvent, IngestEventKind } from "./types";

type Listener<K extends IngestEventKind> = (
    event: Extract<IngestEvent, { kind: K }>,
) => void;

// Erased listener type stored in the per-kind bucket. The Map key (kind)
// guarantees every listener in a bucket was registered with the matching
// generic K, so the cast inside `emit` is sound at runtime.
type AnyListener = (event: IngestEvent) => void;

export interface IngestEventDispatcher {
    /**
     * Fan out a batch of events to registered subscribers.
     * Events are dispatched in array order; for each event, subscribers fire
     * in registration order. A throwing subscriber is caught + logged and
     * does NOT block the rest of the batch.
     */
    emit(events: readonly IngestEvent[]): void;

    /**
     * Register a subscriber for a single event kind. Returns an unsubscribe
     * function. Calling unsubscribe more than once is safe (idempotent).
     */
    on<K extends IngestEventKind>(kind: K, listener: Listener<K>): () => void;
}

export function createIngestEventDispatcher(): IngestEventDispatcher {
    const listeners = new Map<IngestEventKind, Set<AnyListener>>();

    return {
        emit(events) {
            for (const event of events) {
                const bucket = listeners.get(event.kind);
                if (!bucket || bucket.size === 0) continue;
                // Snapshot so a listener that unsubscribes itself mid-dispatch
                // doesn't perturb iteration.
                for (const listener of Array.from(bucket)) {
                    try {
                        listener(event);
                    } catch (err) {
                        log.warn(
                            `[ingestEvents] subscriber for '${event.kind}' threw: ${
                                err instanceof Error ? err.message : String(err)
                            }`,
                        );
                    }
                }
            }
        },
        on(kind, listener) {
            let bucket = listeners.get(kind);
            if (!bucket) {
                bucket = new Set();
                listeners.set(kind, bucket);
            }
            const erased = listener as unknown as AnyListener;
            bucket.add(erased);
            return () => {
                const b = listeners.get(kind);
                if (!b) return;
                b.delete(erased);
                if (b.size === 0) {
                    listeners.delete(kind);
                }
            };
        },
    };
}

/**
 * The App-side singleton that SyncUpdateIngest / SyncEphemeralIngest emit
 * into. Wired once during `Sync` construction — every subscriber
 * (voiceHooks, notifyTaskComplete, dispatchTerminalSignal, the six
 * `*.invalidate()` triggers, the listener `Set<Listener>` callbacks) calls
 * `ingestEvents.on(kind, ...)` here.
 *
 * Tests that need subscriber isolation between cases should construct their
 * own with {@link createIngestEventDispatcher} rather than mutating this one.
 */
export const ingestEvents: IngestEventDispatcher = createIngestEventDispatcher();
