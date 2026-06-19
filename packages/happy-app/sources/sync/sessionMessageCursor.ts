/**
 * Per-session read cursor: the single owner of "how far have we consumed this
 * session's message stream, and which live pushes have we already applied".
 *
 * Before this module, three overlapping pieces of state were scattered across
 * the Sync class and leaked through UpdateHandlerContext / MessageFetchContext:
 *
 *   - `sessionLastSeq: Map<sid, number>` — written by BOTH the live push handler
 *     and the backfill fetch loop (5 sites), so no single owner of the seq.
 *   - `saveLastSeq(sid, seq)` — persistence fired ad hoc next to each `.set()`.
 *   - `processedWebSocketMessageIds: Map<sid, Set<string>>` — the live dedup set,
 *     hand-managed (cap eviction inline) only on the live path.
 *
 * Collapsing them here gives seq a single write point (`advanceTo`, which also
 * persists), folds the live gap/echo decision and dedup into one place, and lets
 * the whole "cursor" be tested without standing up a Sync instance.
 *
 * The cursor does NOT compute how far a backfill page advanced — that rule lives
 * in `resolveMessageCursorAdvance` (messageCursor.ts) and stays there. The
 * backfill loop calls that, then funnels the result through `advanceTo` so the
 * seq still has one owner.
 */

/** Max number of recently-applied live message ids retained for dedup. */
export const SEEN_IDS_CAP = 200;

/** How an incoming live push relates to what we've already consumed. */
export type IncomingClassification = "consecutive" | "gap" | "echo";

/** Persist callback — injected so the cursor owns *when* seq is saved, while the
 *  actual storage mechanism stays a swappable adapter (real persistence in prod,
 *  a spy in tests). */
export type SaveLastSeq = (sessionId: string, seq: number) => void;

export class SessionMessageCursor {
  private readonly sessionId: string;
  private readonly save: SaveLastSeq;
  private seq: number;
  private readonly seen = new Set<string>();

  constructor(sessionId: string, save: SaveLastSeq, initialSeq = 0) {
    this.sessionId = sessionId;
    this.save = save;
    this.seq = initialSeq;
  }

  /** Highest seq consumed so far (0 before anything). */
  lastSeq(): number {
    return this.seq;
  }

  /**
   * The single write point for the cursor's seq. Advances only forward, and
   * persists on every real advance so the on-disk cursor cannot lag the
   * in-memory one. A non-advancing call (seq <= current) is a no-op — neither
   * the live path nor backfill should ever move the cursor backwards.
   *
   * @returns true if the cursor advanced.
   */
  advanceTo(seq: number): boolean {
    if (seq <= this.seq) {
      return false;
    }
    this.seq = seq;
    this.save(this.sessionId, seq);
    return true;
  }

  /**
   * Classify a live push by its seq, relative to what we've consumed:
   *   - "consecutive": the very next seq (lastSeq + 1) — apply directly.
   *   - "echo": seq <= lastSeq — already consumed (POST ack / earlier fetch);
   *     applying it again would duplicate, so the caller skips the gap-fetch.
   *   - "gap": seq > lastSeq + 1 — we missed something; caller should backfill.
   *
   * Pure: does not mutate the cursor. Seq advance happens via advanceTo,
   * dedup via markApplied.
   */
  classifyIncoming(seq: number): IncomingClassification {
    if (seq <= this.seq) {
      return "echo";
    }
    if (seq === this.seq + 1) {
      return "consecutive";
    }
    return "gap";
  }

  /**
   * Dedup a live push by its stable server DB id. Returns "duplicate" if this id
   * was already applied (the same WebSocket event re-delivered after a reconnect
   * / delivery quirk), else records it as "new". Bounded to SEEN_IDS_CAP by
   * evicting the oldest id — Set preserves insertion order, so the first entry
   * is the oldest.
   */
  markApplied(messageDbId: string): "new" | "duplicate" {
    if (this.seen.has(messageDbId)) {
      return "duplicate";
    }
    this.seen.add(messageDbId);
    if (this.seen.size > SEEN_IDS_CAP) {
      const oldest = this.seen.values().next().value as string;
      this.seen.delete(oldest);
    }
    return "new";
  }

  /**
   * Drop the live dedup set while keeping the seq. Used on LRU eviction: the
   * session stays on the server so its seq must survive (else re-open replays),
   * but the bounded dedup set is rebuildable and can be released.
   */
  releaseDedup(): void {
    this.seen.clear();
  }
}

/**
 * The single owner of every session's {@link SessionMessageCursor}. Replaces the
 * two parallel maps (`sessionLastSeq` + `processedWebSocketMessageIds`) that used
 * to be scattered across the Sync class and leaked through the handler/fetch
 * contexts. Seeds each cursor's seq from persisted state on first access.
 */
export class SessionMessageCursorRegistry {
  private readonly cursors = new Map<string, SessionMessageCursor>();
  private readonly save: SaveLastSeq;
  private readonly deleteSaved: (sessionId: string) => void;
  private readonly seeds: Map<string, number>;

  constructor(
    save: SaveLastSeq,
    seeds: Map<string, number> = new Map(),
    deleteSaved: (sessionId: string) => void = () => {},
  ) {
    this.save = save;
    this.seeds = seeds;
    this.deleteSaved = deleteSaved;
  }

  /** Get-or-create the cursor for a session, seeded from persisted seq once. */
  get(sessionId: string): SessionMessageCursor {
    let cursor = this.cursors.get(sessionId);
    if (!cursor) {
      cursor = new SessionMessageCursor(
        sessionId,
        this.save,
        this.seeds.get(sessionId) ?? 0,
      );
      this.cursors.set(sessionId, cursor);
    }
    return cursor;
  }

  /** True if a cursor already exists (without creating one). */
  has(sessionId: string): boolean {
    return this.cursors.has(sessionId);
  }

  /** Highest known seq for a session without creating a cursor — checks the
   *  live cursor first, then the persisted seed. Returns 0 if neither exists. */
  peekSeq(sessionId: string): number {
    const cursor = this.cursors.get(sessionId);
    if (cursor) return cursor.lastSeq();
    return this.seeds.get(sessionId) ?? 0;
  }

  /** Seed (or reset) a session's seq before its cursor is first read — used when
   *  re-hydrating from cache. No-op if the cursor already exists and is ahead. */
  seed(sessionId: string, seq: number): void {
    const existing = this.cursors.get(sessionId);
    if (existing) {
      existing.advanceTo(seq);
    } else {
      this.seeds.set(sessionId, seq);
    }
  }

  /**
   * Forget a session entirely (seq + dedup), including the PERSISTED seq. Used on
   * delete / 404 cleanup / forced refetch — every caller of `delete` wants the
   * cursor reset to 0 on the next read, so the persisted seq must go too (else it
   * re-seeds stale). Callers no longer pair this with a separate `deleteLastSeq`.
   * Contrast with the eviction path, which uses `releaseDedup()` to KEEP the seq.
   */
  delete(sessionId: string): void {
    this.cursors.delete(sessionId);
    this.seeds.delete(sessionId);
    this.deleteSaved(sessionId);
  }
}
