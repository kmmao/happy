/**
 * xtermSnapshotCache — per-terminalId xterm.js buffer persistence in
 * `localStorage`, so a browser refresh can restore the previously-visible
 * terminal state instead of falling back to the daemon's 256 KB rolling
 * replay buffer.
 *
 * Why this exists
 * ---------------
 * The daemon-side {@link import("@kmmao/happy-wire").createReplayBuffer}
 * only keeps the most recent 256 KB (`DEFAULT_BUFFER_BYTES = 4 * 64 KB` in
 * `claudePtyRouter.ts`) of PTY output and, worse, aggressively drops history
 * before any clear-screen / alt-screen marker (see `replayBuffer.ts:34-55`
 * for the sync-point patterns). On sessions with many tool calls the recent
 * "interesting" content — Plan output, big Bash results — falls off the end
 * of that ring long before the user hits refresh, and any PTY tear-down
 * (SIGTERM from `ExitPlanMode`, mode-change cold restart) resets the buffer
 * to empty, permanently discarding what was on screen.
 *
 * Approach
 * --------
 * The web `WebTerminal` component wires an `@xterm/addon-serialize` instance
 * into its xterm.js terminal. Every time new bytes arrive (via the ephemeral
 * socket listener), we debounce a call to `terminal.serialize()` which
 * returns a self-contained ANSI-sequence string that recreates the current
 * screen + scrollback. That string is stored here, keyed by `terminalId`
 * (`claude:<sessionId>` for the Claude PTY tab; a cuid2 for shell tabs).
 *
 * On next mount, the terminal is first `write()`-fed the persisted snapshot
 * (so the user immediately sees the pre-refresh screen), then subscribed to
 * fresh events for anything new. When a snapshot exists we skip the daemon's
 * `recentOutput` — the client cache is a strict superset (has full scrollback
 * to `MAX_SNAPSHOT_BYTES`, and doesn't get truncated by sync-point patterns).
 *
 * Storage layout
 * --------------
 *   "xterm-v1-<terminalId>"    → JSON string, `PersistedSnapshot` shape
 *   "xterm-cache-index"         → JSON array of `{ terminalId, savedAt }`
 *
 * We enforce two caps to keep the origin's localStorage healthy:
 *
 *   - `MAX_SNAPSHOT_BYTES` — a single snapshot larger than this is
 *      silently dropped; xterm rebuilds from the daemon's small snapshot
 *      instead. 512 KB fits ~120 rows × ~4000 cols of dense output.
 *   - `MAX_SESSIONS` — the cache holds the {@link MAX_SESSIONS} most-
 *      recently-updated terminals. A save that would overshoot evicts the
 *      oldest half in one pass so we don't quadratically fight the quota.
 *
 * Both `saveXtermSnapshot` and `loadXtermSnapshot` are best-effort — any
 * localStorage error (QuotaExceededError, storage disabled in the tab,
 * malformed JSON from an older schema) is swallowed; the caller falls back
 * to the daemon's snapshot path and no user-visible failure surfaces.
 *
 * Web-only
 * --------
 * The web WebTerminal is the only consumer. Native platforms don't render
 * the terminal via xterm.js and wouldn't have anything to serialize; this
 * module guards on `typeof window` so it's safe to import from cross-
 * platform files, but every operation is a no-op outside a browser.
 */

// Keyed under `xterm-v1-<terminalId>` so we can bump `v1` if the
// SerializeAddon output format changes in a future @xterm/addon-serialize
// release (unlikely — it's just ANSI escapes — but cheap insurance).
const KEY_PREFIX = "xterm-v1-";
const INDEX_KEY = "xterm-cache-index";
const SCHEMA_VERSION = 1;

// 512 KB per session — enough for a full screen + several screens of
// scrollback while leaving room for ~10 concurrent sessions inside a
// typical 5-10 MB localStorage quota.
const MAX_SNAPSHOT_BYTES = 512 * 1024;

// LRU cap. Beyond this, oldest entries are evicted. Keeps quota use bounded
// even if a user opens many sessions across days without clearing storage.
const MAX_SESSIONS = 20;

interface PersistedSnapshot {
    schemaVersion: number;
    terminalId: string;
    /** SerializeAddon output — self-contained ANSI sequences. */
    serialized: string;
    savedAt: number;
}

interface CacheIndexEntry {
    terminalId: string;
    savedAt: number;
}

function getStorage(): Storage | null {
    if (typeof window === "undefined") return null;
    try {
        // Access can throw on iframes with a null origin or when the user
        // has disabled site data — treat both as "no cache available".
        return window.localStorage;
    } catch {
        return null;
    }
}

/**
 * Load a previously-persisted snapshot for `terminalId`, or `null` if no
 * snapshot exists / storage is unavailable / the stored payload is corrupt
 * or from a different schema.
 */
export function loadXtermSnapshot(terminalId: string): string | null {
    const s = getStorage();
    if (!s) return null;
    try {
        const raw = s.getItem(KEY_PREFIX + terminalId);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PersistedSnapshot;
        if (
            !parsed ||
            parsed.schemaVersion !== SCHEMA_VERSION ||
            typeof parsed.serialized !== "string"
        ) {
            return null;
        }
        return parsed.serialized;
    } catch {
        return null;
    }
}

/**
 * Persist a fresh serialization of `terminalId`'s xterm state. Silently
 * discards snapshots larger than {@link MAX_SNAPSHOT_BYTES} — an oversize
 * snapshot is more likely to blow the quota (and take a slow synchronous
 * `setItem` doing it) than provide useful history.
 *
 * On `QuotaExceededError`, evicts the oldest half of the LRU index and
 * retries once. Second failure is swallowed — better to skip this save
 * than to raise into the caller's terminal-write hot path.
 */
export function saveXtermSnapshot(terminalId: string, serialized: string): void {
    const s = getStorage();
    if (!s) return;
    if (serialized.length > MAX_SNAPSHOT_BYTES) return;

    const payload: PersistedSnapshot = {
        schemaVersion: SCHEMA_VERSION,
        terminalId,
        serialized,
        savedAt: Date.now(),
    };
    const serializedPayload = JSON.stringify(payload);
    const key = KEY_PREFIX + terminalId;

    try {
        s.setItem(key, serializedPayload);
        touchIndex(s, terminalId);
    } catch {
        // Very likely QuotaExceededError. Drop the oldest half of the LRU
        // and try once more; if that still fails, give up so the caller
        // isn't stalled inside the terminal-output handler.
        try {
            evictOldestHalf(s);
            s.setItem(key, serializedPayload);
            touchIndex(s, terminalId);
        } catch {
            // Give up — persistence is best-effort by contract.
        }
    }
}

/**
 * Explicitly forget a terminal's snapshot. Called from tests; production
 * code relies on LRU eviction and per-app-refresh replacement.
 */
export function deleteXtermSnapshot(terminalId: string): void {
    const s = getStorage();
    if (!s) return;
    try {
        s.removeItem(KEY_PREFIX + terminalId);
        removeFromIndex(s, terminalId);
    } catch {
        // ignore — nothing to do if storage is broken
    }
}

/** Test-only: wipe all snapshots + the index in one go. */
export function clearAllXtermSnapshots(): void {
    const s = getStorage();
    if (!s) return;
    try {
        const index = loadIndex(s);
        for (const entry of index) {
            s.removeItem(KEY_PREFIX + entry.terminalId);
        }
        s.removeItem(INDEX_KEY);
    } catch {
        // ignore
    }
}

// ─── Internal LRU index management ────────────────────────────────────────

function loadIndex(s: Storage): CacheIndexEntry[] {
    try {
        const raw = s.getItem(INDEX_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return (parsed as CacheIndexEntry[]).filter(
            (e) => e && typeof e.terminalId === "string" && typeof e.savedAt === "number",
        );
    } catch {
        return [];
    }
}

function saveIndex(s: Storage, index: CacheIndexEntry[]): void {
    try {
        s.setItem(INDEX_KEY, JSON.stringify(index));
    } catch {
        // index write failure is not fatal — worst case an eviction pass
        // rebuilds it from the surviving snapshot keys next time.
    }
}

function touchIndex(s: Storage, terminalId: string): void {
    const index = loadIndex(s).filter((e) => e.terminalId !== terminalId);
    index.push({ terminalId, savedAt: Date.now() });
    if (index.length > MAX_SESSIONS) {
        const sorted = index.sort((a, b) => a.savedAt - b.savedAt);
        const toEvict = sorted.slice(0, sorted.length - MAX_SESSIONS);
        for (const e of toEvict) {
            try {
                s.removeItem(KEY_PREFIX + e.terminalId);
            } catch {
                // continue evicting the rest even if one fails
            }
        }
        saveIndex(s, sorted.slice(sorted.length - MAX_SESSIONS));
    } else {
        saveIndex(s, index);
    }
}

function removeFromIndex(s: Storage, terminalId: string): void {
    const index = loadIndex(s).filter((e) => e.terminalId !== terminalId);
    saveIndex(s, index);
}

/**
 * Drop the oldest half of the LRU (rounded up) in one pass. Called from
 * the QuotaExceededError recovery path — chipping off entries one at a
 * time would repeat the failing `setItem` many times and stall the caller.
 */
function evictOldestHalf(s: Storage): void {
    const index = loadIndex(s);
    if (index.length === 0) return;
    const sorted = [...index].sort((a, b) => a.savedAt - b.savedAt);
    const evictCount = Math.max(1, Math.ceil(sorted.length / 2));
    const toEvict = sorted.slice(0, evictCount);
    for (const e of toEvict) {
        try {
            s.removeItem(KEY_PREFIX + e.terminalId);
        } catch {
            // continue
        }
    }
    saveIndex(s, sorted.slice(evictCount));
}
