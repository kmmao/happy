import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicFileWrite } from "@/utils/fileAtomic";
import type { TrackedSession } from "./types";

export interface PersistedTrackedSession {
  /**
   * Daemon-generated UUID for the spawn. Present on daemon-spawned sessions
   * from the moment the child is forked, even before the server assigns a
   * `happySessionId`. Externally-started sessions (user ran `happy claude`
   * directly) have only `happySessionId`.
   */
  spawnId?: string;
  /**
   * Server-assigned session id. Populated after the child posts to
   * /session-started. Before that, daemon-spawned entries have only spawnId.
   */
  happySessionId?: string;
  pid: number;
  startedBy: string;
  startedAt?: number;
  lastActivityAt?: number;
  lastOutputAt?: number;
  /** Wall-clock time of the child's most recent /session-heartbeat call. */
  lastHeartbeatAt?: number;
  /** Most recent activity reported in heartbeat payload. */
  activity?: "idle" | "thinking" | "executing" | "blocked";
  automationContext?: TrackedSession["automationContext"];
  tmuxSessionId?: string;
  directoryCreated?: boolean;
  message?: string;
}

interface TrackedSessionStoreFile {
  version: 1 | 2;
  sessions: PersistedTrackedSession[];
}

const CURRENT_VERSION = 2;

const EMPTY_STORE: TrackedSessionStoreFile = {
  version: CURRENT_VERSION,
  sessions: [],
};

/**
 * Stable primary key for a persisted entry. spawnId wins when present —
 * daemon-spawned entries keep the same key across the "pre-/session-started"
 * and "post-/session-started" phases, avoiding a re-key dance when the server
 * assigns a happySessionId later.
 */
function pickPrimaryKey(entry: {
  spawnId?: string;
  happySessionId?: string;
}): string | undefined {
  if (entry.spawnId) return `spawn:${entry.spawnId}`;
  if (entry.happySessionId) return `sess:${entry.happySessionId}`;
  return undefined;
}

export function toPersistedTrackedSession(session: TrackedSession): PersistedTrackedSession | undefined {
  if (!session.spawnId && !session.happySessionId) {
    return undefined;
  }
  return {
    spawnId: session.spawnId,
    happySessionId: session.happySessionId,
    pid: session.pid,
    startedBy: session.startedBy,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    lastOutputAt: session.lastOutputAt,
    lastHeartbeatAt: session.lastHeartbeatAt,
    activity: session.activity,
    automationContext: session.automationContext,
    tmuxSessionId: session.tmuxSessionId,
    directoryCreated: session.directoryCreated,
    message: session.message,
  };
}

export class TrackedSessionRegistry {
  private entries = new Map<string, PersistedTrackedSession>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as TrackedSessionStoreFile;
      // v1 and v2 share the same array shape — v2 just adds optional fields.
      // v1 entries have happySessionId guaranteed; v2 entries may have spawnId
      // alone. Accept both and drop anything without either identifier.
      this.entries.clear();
      for (const entry of parsed.sessions ?? []) {
        const primaryKey = pickPrimaryKey(entry);
        if (!primaryKey) continue;
        this.entries.set(primaryKey, entry);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.entries.clear();
      await this.flush();
    }
    this.loaded = true;
  }

  getAll(): PersistedTrackedSession[] {
    return [...this.entries.values()].sort((a, b) => {
      const aTime = a.lastHeartbeatAt ?? a.lastActivityAt ?? a.startedAt ?? 0;
      const bTime = b.lastHeartbeatAt ?? b.lastActivityAt ?? b.startedAt ?? 0;
      return bTime - aTime;
    });
  }

  get(happySessionId: string): PersistedTrackedSession | undefined {
    // Prefer sess: key first — populated for externally-started sessions and
    // for any entry whose primary key was chosen as sess: at insert time.
    const direct = this.entries.get(`sess:${happySessionId}`);
    if (direct) return direct;
    // Fallback: scan — daemon-spawned entries keyed by spawn: may also carry
    // a happySessionId once the /session-started webhook has fired.
    for (const entry of this.entries.values()) {
      if (entry.happySessionId === happySessionId) return entry;
    }
    return undefined;
  }

  getBySpawnId(spawnId: string): PersistedTrackedSession | undefined {
    return this.entries.get(`spawn:${spawnId}`);
  }

  async upsert(session: PersistedTrackedSession): Promise<void> {
    const primaryKey = pickPrimaryKey(session);
    if (!primaryKey) return;
    this.entries.set(primaryKey, session);
    await this.flush();
  }

  async rememberTrackedSession(session: TrackedSession): Promise<void> {
    const persisted = toPersistedTrackedSession(session);
    if (!persisted) {
      return;
    }
    const primaryKey = pickPrimaryKey(persisted);
    if (!primaryKey) return;
    this.entries.set(primaryKey, persisted);
    await this.flush();
  }

  async forgetSession(happySessionId: string): Promise<void> {
    const directKey = `sess:${happySessionId}`;
    if (this.entries.has(directKey)) {
      this.entries.delete(directKey);
      await this.flush();
      return;
    }
    // Entry may be keyed by spawn: with happySessionId as secondary attribute.
    for (const [key, entry] of this.entries) {
      if (entry.happySessionId === happySessionId) {
        this.entries.delete(key);
        await this.flush();
        return;
      }
    }
  }

  async forgetSpawn(spawnId: string): Promise<void> {
    const key = `spawn:${spawnId}`;
    if (!this.entries.has(key)) return;
    this.entries.delete(key);
    await this.flush();
  }

  async clear(): Promise<void> {
    if (this.entries.size === 0) {
      return;
    }
    this.entries.clear();
    await this.flush();
  }

  private async flush(): Promise<void> {
    const payload: TrackedSessionStoreFile = {
      ...EMPTY_STORE,
      sessions: this.getAll(),
    };
    await atomicFileWrite(this.filePath, JSON.stringify(payload, null, 2));
  }
}
