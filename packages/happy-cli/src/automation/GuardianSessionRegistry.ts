import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicFileWrite } from "@/utils/fileAtomic";
import type { SupervisorTriggerData } from "@/api/apiMachine";

export interface GuardianSessionEntry {
  key: string;
  projectId: string;
  sessionId: string;
  updatedAt: number;
  loopId?: string;
  lastRunId?: string;
}

interface GuardianSessionStoreFile {
  version: 1;
  entries: GuardianSessionEntry[];
}

const EMPTY_STORE: GuardianSessionStoreFile = {
  version: 1,
  entries: [],
};

function buildGuardianKeys(data: SupervisorTriggerData): string[] {
  if (data.trigger === "fix") {
    return [];
  }
  const keys: string[] = [];
  if (data.loopId) {
    keys.push(`loop:${data.loopId}`);
  }
  // Include trigger type so analysis and research have independent guardian sessions
  keys.push(`project:${data.projectId}:${data.trigger}`);
  return keys;
}

export function getGuardianContinuityKey(data: SupervisorTriggerData): string | undefined {
  return buildGuardianKeys(data)[0];
}

export class GuardianSessionRegistry {
  private entries = new Map<string, GuardianSessionEntry>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as GuardianSessionStoreFile;
      this.entries = new Map(parsed.entries.map((entry) => [entry.key, entry]));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.entries = new Map();
      await this.flush();
    }
    this.loaded = true;
  }

  getSnapshot(): GuardianSessionEntry[] {
    return [...this.entries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  resolveForSupervisor(data: SupervisorTriggerData): string | undefined {
    for (const key of buildGuardianKeys(data)) {
      const entry = this.entries.get(key);
      if (entry?.sessionId) {
        return entry.sessionId;
      }
    }
    return undefined;
  }

  resolveByKey(key: string): string | undefined {
    return this.entries.get(key)?.sessionId;
  }

  async rememberForSupervisor(
    data: SupervisorTriggerData,
    sessionId: string,
  ): Promise<void> {
    const updatedAt = Date.now();
    for (const key of buildGuardianKeys(data)) {
      this.entries.set(key, {
        key,
        projectId: data.projectId,
        loopId: data.loopId,
        lastRunId: data.runId,
        sessionId,
        updatedAt,
      });
    }
    await this.flush();
  }

  async rememberByKey(params: {
    key: string;
    projectId?: string;
    loopId?: string;
    lastRunId?: string;
    sessionId: string;
  }): Promise<void> {
    this.entries.set(params.key, {
      key: params.key,
      projectId: params.projectId ?? "",
      loopId: params.loopId,
      lastRunId: params.lastRunId,
      sessionId: params.sessionId,
      updatedAt: Date.now(),
    });
    await this.flush();
  }

  async forgetSession(sessionId: string): Promise<void> {
    let changed = false;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.sessionId === sessionId) {
        this.entries.delete(key);
        changed = true;
      }
    }
    if (changed) {
      await this.flush();
    }
  }

  async forgetByProjectAndTrigger(projectId: string, trigger: string): Promise<void> {
    await this.forgetKey(`project:${projectId}:${trigger}`);
  }

  async forgetLoop(loopId: string): Promise<void> {
    let changed = false;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.loopId === loopId) {
        this.entries.delete(key);
        changed = true;
      }
    }
    if (changed) {
      await this.flush();
    }
  }

  async forgetKey(key: string): Promise<void> {
    if (!this.entries.has(key)) {
      return;
    }
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
    const payload: GuardianSessionStoreFile = {
      ...EMPTY_STORE,
      entries: this.getSnapshot(),
    };
    await atomicFileWrite(this.filePath, JSON.stringify(payload, null, 2));
  }
}
