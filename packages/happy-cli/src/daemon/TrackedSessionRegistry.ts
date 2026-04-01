import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicFileWrite } from "@/utils/fileAtomic";
import type { TrackedSession } from "./types";

export interface PersistedTrackedSession {
  happySessionId: string;
  pid: number;
  startedBy: string;
  startedAt?: number;
  lastActivityAt?: number;
  lastOutputAt?: number;
  automationContext?: TrackedSession["automationContext"];
  tmuxSessionId?: string;
  directoryCreated?: boolean;
  message?: string;
}

interface TrackedSessionStoreFile {
  version: 1;
  sessions: PersistedTrackedSession[];
}

const EMPTY_STORE: TrackedSessionStoreFile = {
  version: 1,
  sessions: [],
};

export function toPersistedTrackedSession(session: TrackedSession): PersistedTrackedSession | undefined {
  if (!session.happySessionId) {
    return undefined;
  }
  return {
    happySessionId: session.happySessionId,
    pid: session.pid,
    startedBy: session.startedBy,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    lastOutputAt: session.lastOutputAt,
    automationContext: session.automationContext,
    tmuxSessionId: session.tmuxSessionId,
    directoryCreated: session.directoryCreated,
    message: session.message,
  };
}

export class TrackedSessionRegistry {
  private sessions = new Map<string, PersistedTrackedSession>();
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
      this.sessions = new Map(parsed.sessions.map((session) => [session.happySessionId, session]));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.sessions = new Map();
      await this.flush();
    }
    this.loaded = true;
  }

  getAll(): PersistedTrackedSession[] {
    return [...this.sessions.values()].sort((a, b) => {
      const aTime = a.lastActivityAt ?? a.startedAt ?? 0;
      const bTime = b.lastActivityAt ?? b.startedAt ?? 0;
      return bTime - aTime;
    });
  }

  get(happySessionId: string): PersistedTrackedSession | undefined {
    return this.sessions.get(happySessionId);
  }

  async upsert(session: PersistedTrackedSession): Promise<void> {
    this.sessions.set(session.happySessionId, session);
    await this.flush();
  }

  async rememberTrackedSession(session: TrackedSession): Promise<void> {
    const persisted = toPersistedTrackedSession(session);
    if (!persisted) {
      return;
    }
    this.sessions.set(persisted.happySessionId, persisted);
    await this.flush();
  }

  async forgetSession(happySessionId: string): Promise<void> {
    if (!this.sessions.has(happySessionId)) {
      return;
    }
    this.sessions.delete(happySessionId);
    await this.flush();
  }

  async clear(): Promise<void> {
    if (this.sessions.size === 0) {
      return;
    }
    this.sessions.clear();
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
