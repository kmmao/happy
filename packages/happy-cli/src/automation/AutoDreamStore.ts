import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicFileWrite } from "@/utils/fileAtomic";

export type AutoDreamProfileStatus = "idle" | "running" | "paused" | "failed";
export type AutoDreamStage = "starting" | "scanning" | "analyzing" | "writing" | "updating";

export interface AutoDreamProfile {
  id: string;
  name?: string;
  rootDirectory: string;
  intervalMs: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  status: AutoDreamProfileStatus;
  stage: AutoDreamStage;
  statusUpdatedAt: number;
  maxDepth?: number;
  limit?: number;
  lastRunAt?: number;
  lastError?: string;
  lastMemoryFiles?: number;
  lastUpdatedFiles?: number;
  latestDreamFilePath?: string;
}

interface AutoDreamStoreFile {
  version: 1;
  profiles: AutoDreamProfile[];
}

const EMPTY_STORE: AutoDreamStoreFile = {
  version: 1,
  profiles: [],
};

function normalizeProfile(profile: AutoDreamProfile): AutoDreamProfile {
  return {
    ...profile,
    status: profile.enabled ? (profile.status ?? "idle") : "paused",
    stage: profile.stage ?? "starting",
  };
}

export class AutoDreamStore {
  private profiles = new Map<string, AutoDreamProfile>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as AutoDreamStoreFile;
      this.profiles = new Map(parsed.profiles.map((profile) => [profile.id, normalizeProfile(profile)]));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      this.profiles = new Map();
      await this.flush();
    }
    this.loaded = true;
  }

  getAll(): AutoDreamProfile[] {
    return [...this.profiles.values()].sort((a, b) => a.nextRunAt - b.nextRunAt || a.id.localeCompare(b.id));
  }

  get(id: string): AutoDreamProfile | undefined {
    return this.profiles.get(id);
  }

  async upsert(profile: AutoDreamProfile): Promise<void> {
    this.profiles.set(profile.id, normalizeProfile(profile));
    await this.flush();
  }

  async remove(id: string): Promise<void> {
    if (!this.profiles.has(id)) return;
    this.profiles.delete(id);
    await this.flush();
  }

  private async flush(): Promise<void> {
    await atomicFileWrite(this.filePath, JSON.stringify({ ...EMPTY_STORE, profiles: this.getAll() }, null, 2));
  }
}
