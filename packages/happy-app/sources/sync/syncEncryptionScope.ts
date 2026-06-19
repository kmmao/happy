import { log } from "@/log";
import type { Encryption } from "./encryption/encryption";
import type { SessionEncryption } from "./encryption/sessionEncryption";
import type { MachineEncryption } from "./encryption/machineEncryption";

/**
 * The narrow context this seam actually needs — the encryptor lookup plus the
 * per-scope race-recovery primitives (`awaitQueue` to block on an in-flight
 * sync, `forceRefetch` to recover). `IngestContext` is structurally assignable
 * to it, so the ingest seam passes its `ctx` directly with no adapter object.
 */
type ScopeEncryptionContext = {
    readonly encryption: Pick<
        Encryption,
        "getSessionEncryption" | "getMachineEncryption"
    >;
    readonly sessionsSync: {
        readonly awaitQueue: () => Promise<void>;
        readonly forceRefetch: () => void;
    };
    readonly machinesSync: {
        readonly awaitQueue: () => Promise<void>;
        readonly forceRefetch: () => void;
    };
};

/**
 * The single owner of one invariant that used to be copy-pasted — and had
 * silently drifted — across every scope-encrypted update handler:
 *
 *   "Before decrypting a scope's content, the scope's encryption must be
 *    ready. If it isn't, the push lost a startup race against the in-flight
 *    sync (#80/#84) — wait for that sync to settle and re-read once; if it is
 *    still missing, trigger a refetch and skip this update."
 *
 * Previously each handler reimplemented this: new-message / update-session did
 * `getEncryption → awaitQueue → re-read → fetchSessions`, while update-machine
 * skipped the awaitQueue + refetch entirely — so a machine update that raced
 * its sync was simply dropped. Centralizing the policy here makes it live in
 * exactly one place and extends the race fix to the machine scope for free.
 *
 * Artifacts are intentionally NOT covered: an Artifact carries its own
 * per-artifact data key (ADR-0001 E2E encryption), not a scope encryptor
 * fetched from `ctx.encryption`, so it is a different kind of scope.
 */
async function resolveScope<E>(
    get: () => E | null,
    awaitSync: () => Promise<void>,
    recover: () => void,
    label: string,
): Promise<E | null> {
    let value = get();
    if (!value) {
        // Startup race: the push arrived before the in-flight sync registered
        // this id's encryption. Wait for it to settle, then re-read once.
        await awaitSync();
        value = get();
    }
    if (!value) {
        log.warn(`${label} encryption not ready after awaiting sync; refetching to recover`);
        recover();
        return null;
    }
    return value;
}

/**
 * Resolve a Session's encryptor, recovering from the startup race. Returns
 * null when it cannot be made ready (a refetch has already been triggered);
 * callers should simply return.
 */
export function resolveSessionEncryption(
    sessionId: string,
    ctx: ScopeEncryptionContext,
    extraReady?: () => boolean,
): Promise<SessionEncryption | null> {
    return resolveScope(
        () => {
            const encryption = ctx.encryption.getSessionEncryption(sessionId);
            // Some callers (update-session) also need the session row to exist.
            // forceRefetch registers the encryptor (initializeSessions) BEFORE
            // it writes the row (applySessions), so there is a window where the
            // encryptor exists but the row does not — gating on encryption alone
            // would drop the update in that window instead of awaiting the sync.
            if (!encryption || (extraReady && !extraReady())) {
                return null;
            }
            return encryption;
        },
        () => ctx.sessionsSync.awaitQueue(),
        () => ctx.sessionsSync.forceRefetch(),
        `session ${sessionId}`,
    );
}

/**
 * Resolve a Machine's encryptor, recovering from the startup race. Returns
 * null when it cannot be made ready (a refetch has already been triggered);
 * callers should simply return.
 */
export function resolveMachineEncryption(
    machineId: string,
    ctx: ScopeEncryptionContext,
): Promise<MachineEncryption | null> {
    return resolveScope(
        () => ctx.encryption.getMachineEncryption(machineId),
        () => ctx.machinesSync.awaitQueue(),
        () => ctx.machinesSync.forceRefetch(),
        `machine ${machineId}`,
    );
}
