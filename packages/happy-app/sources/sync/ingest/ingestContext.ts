/**
 * The minimal context required by SyncUpdateIngest. Replaces the 24-field
 * UpdateHandlerContext (`syncUpdateHandlers.ts:59–89`) that today threads
 * through every handler signature (see ADR-0026 Decision D).
 *
 * What this context owns:
 *
 *   - `encryption` — the Encryption module. Per-variant cases call
 *     `getSessionEncryption(sid)` / `getMachineEncryption(mid)` to obtain
 *     a scope's data key. The `syncEncryptionScope.ts` internal seam
 *     wraps the startup-race + refetch-recovery invariant on top.
 *   - `cursor` — per-session seq + dedup. Variants that mutate per-session
 *     state (new-message, delete-session) reach in to advance or release
 *     the cursor.
 *   - `sessionsSync` / `machinesSync` — race-recovery primitives used by
 *     `syncEncryptionScope.ts`. `awaitQueue` blocks on an in-flight sync;
 *     `forceRefetch` triggers a recovery sync as the fallback. These are
 *     the seam's OWN handles, not subscriber concerns: the `sessions-stale`
 *     / `machines-stale` IngestEvents subscribers register independently
 *     and call `sessionsSync.invalidate()` themselves.
 *
 * What this context does NOT own (anything previously on
 * UpdateHandlerContext that isn't here is a subscriber concern):
 *
 *   - The other 5 `*.invalidate()` triggers (artifacts/feed/friends/projects/
 *     friend-requests) — wired as subscribers on the matching `*-stale` event.
 *   - The deleted-session set, message-processor queues / outbox, listener
 *     `Set<Listener>` collections, `assumeUsers`, `onSessionVisible`,
 *     `applySessions` / `enqueueMessages` / `releaseMessageProcessing`,
 *     `artifactDataKeys`, etc. — these are either Sync-class internals the
 *     subscribers reach through their own closures, or storage adapters the
 *     seam calls via `storage.getState().*` directly.
 */

import type { Encryption } from "../encryption/encryption";
import type { SessionMessageCursor } from "../sessionMessageCursor";
import type { Session } from "../storageTypes";
import type { NormalizedMessage } from "../typesRaw";
import type { ApiEphemeralActivityUpdate } from "../apiTypes";

export type IngestContext = {
    readonly encryption: Encryption;
    readonly cursor: {
        readonly get: (sessionId: string) => SessionMessageCursor;
        readonly delete: (sessionId: string) => void;
    };
    readonly sessionsSync: {
        /** Block until any in-flight sessions sync settles (race recovery). */
        readonly awaitQueue: () => Promise<void>;
        /** Trigger a sessions refetch as race-recovery fallback. */
        readonly forceRefetch: () => void;
    };
    readonly machinesSync: {
        readonly awaitQueue: () => Promise<void>;
        readonly forceRefetch: () => void;
    };
    /**
     * Sync's per-machine data-key mirror, populated alongside
     * `Encryption.initializeMachines()` so outbound encrypted operations
     * (`fetchMachinesAction`, daemon-state writes) can read the decrypted
     * key without a round-trip through Encryption. The seam updates this
     * map for any variant that brings new key material (today: new-machine);
     * full ownership consolidation into the Encryption module is downstream
     * (PR 7 cleanup).
     */
    readonly machineDataKeys: {
        readonly set: (machineId: string, key: Uint8Array) => void;
    };
    /**
     * Synchronously block on the resolution of the named users into
     * `storage.users[uid]`. Required by `new-feed-post` for friend-request /
     * friend-accepted items, which check the sender's profile is known
     * before applying the feed item. The seam awaits the promise inline
     * (it is not subscriber-driven because the check feeds back into the
     * mutation decision in the same dispatch).
     */
    readonly assumeUsers: (userIds: string[]) => Promise<void>;
    /**
     * Sync's wrapped session-apply path. Differs from
     * `storage.applySessions` in that it also runs per-session side effects
     * (live-message side-channel handling, message processor wakeups).
     * Required by `update-session`; remains on the context until PR 7 can
     * decide whether to lift those side effects into subscribers as well.
     */
    readonly applySessions: (sessions: Session[]) => void;
    /**
     * Trigger Sync's re-read of messages for a Session whose visibility /
     * control just transitioned (e.g. control returned to mobile). Used by
     * `update-session` when agentState.controlledByUser flips false → true.
     */
    readonly onSessionVisible: (sessionId: string) => void;
    /**
     * Per-Artifact data-key mirror — counterpart of `machineDataKeys` for
     * Artifact scope. `new-artifact` populates it from the decrypted key;
     * `update-artifact` reads it to construct the per-artifact encryptor;
     * `delete-artifact` removes it. Full ownership consolidation into the
     * Encryption module is downstream (PR 7 cleanup).
     */
    readonly artifactDataKeys: {
        readonly get: (artifactId: string) => Uint8Array | undefined;
        readonly set: (artifactId: string, key: Uint8Array) => void;
        readonly delete: (artifactId: string) => void;
    };
    /**
     * Sync's per-session message processor queue. `new-message` pushes a
     * decoded NormalizedMessage here after the cursor classified + deduped
     * it; the processor folds the message into the per-session cache on a
     * scheduled rAF frame. This is Sync-class wrapping over `storage`, kept
     * on the context because the queue is process-singleton (PR 7 may push
     * it to a subscriber once cursor + queue can be consolidated).
     */
    readonly enqueueMessages: (
        sessionId: string,
        messages: NormalizedMessage[],
    ) => void;
    /**
     * Sync's debouncing activity-update accumulator. `ingestSyncEphemeral`
     * for `type: "activity"` pushes here instead of writing directly to
     * storage — the accumulator batches several updates into one
     * `applySessions` call to keep terminal-feedback frame rate sane.
     * Owned by Sync (`new ActivityUpdateAccumulator(flush, 500)`); the
     * wrapped function is exposed here so the seam stays decoupled from
     * the accumulator class.
     */
    readonly addActivityUpdate: (update: ApiEphemeralActivityUpdate) => void;
};
