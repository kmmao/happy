import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicFileWrite } from "@/utils/fileAtomic";

export type AgentLoopBootstrapStatus = "idle" | "running" | "paused" | "failed";

export interface AgentLoopBootstrapProfile {
  id: string;
  name?: string;
  rootDirectory: string;
  intervalMs: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  maxDepth?: number;
  limit?: number;
  agent?: "claude" | "codex" | "gemini";
  profileId?: string;
  projectId?: string;
  autoRunCreatedLoops?: boolean;
  status: AgentLoopBootstrapStatus;
  statusUpdatedAt: number;
  lastRunAt?: number;
  lastRepoCount?: number;
  lastSuggestionCount?: number;
  lastCreatedCount?: number;
  lastError?: string;
}

interface AgentLoopBootstrapStoreFile {
  version: 1;
  profiles: AgentLoopBootstrapProfile[];
}


function normalizeStatus(profile: Partial<AgentLoopBootstrapProfile>): AgentLoopBootstrapStatus {
  if (profile.status) {
    return profile.status;
  }
  return profile.enabled === false ? "paused" : "idle";
}

function normalizeProfile(profile: AgentLoopBootstrapProfile): AgentLoopBootstrapProfile {
  const status = normalizeStatus(profile);
  return {
    ...profile,
    status,
    statusUpdatedAt: profile.statusUpdatedAt ?? profile.updatedAt ?? profile.createdAt ?? Date.now(),
  };
}

export class AgentLoopBootstrapStore {
  private profiles = new Map<string, AgentLoopBootstrapProfile>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as AgentLoopBootstrapStoreFile;
      this.profiles = new Map(parsed.profiles.map((profile) => {
        const normalized = normalizeProfile(profile);
        return [normalized.id, normalized];
      }));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.profiles = new Map();
      await this.flush();
    }
    this.loaded = true;
  }

  getAll(): AgentLoopBootstrapProfile[] {
    return [...this.profiles.values()].sort((a, b) => {
      const priority = { running: 0, failed: 1, idle: 2, paused: 3 } as const;
      if (a.status !== b.status) {
        return priority[a.status] - priority[b.status];
      }
      if (a.nextRunAt !== b.nextRunAt) {
        return a.nextRunAt - b.nextRunAt;
      }
      return a.id.localeCompare(b.id);
    });
  }

  get(id: string): AgentLoopBootstrapProfile | undefined {
    return this.profiles.get(id);
  }

  async upsert(profile: AgentLoopBootstrapProfile): Promise<void> {
    this.profiles.set(profile.id, normalizeProfile(profile));
    await this.flush();
  }

  async remove(id: string): Promise<void> {
    this.profiles.delete(id);
    await this.flush();
  }

  private async flush(): Promise<void> {
    const payload: AgentLoopBootstrapStoreFile = {
      version: 1,
      profiles: this.getAll(),
    };
    await atomicFileWrite(this.filePath, JSON.stringify(payload, null, 2));
  }
}
