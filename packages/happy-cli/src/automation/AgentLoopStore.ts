import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicFileWrite } from "@/utils/fileAtomic";

export interface AgentLoopDefinition {
  id: string;
  name?: string;
  prompt: string;
  directory: string;
  intervalMs: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  iteration: number;
  continuityKey: string;
  agent: "claude" | "codex" | "gemini";
  profileId?: string;
  projectId?: string;
  environmentVariables?: Record<string, string>;
  lastEnqueuedAt?: number;
  lastStartedAt?: number;
  lastCompletedAt?: number;
  lastSessionId?: string;
  lastError?: string;
}

interface AgentLoopStoreFile {
  version: 1;
  loops: AgentLoopDefinition[];
}

const EMPTY_STORE: AgentLoopStoreFile = {
  version: 1,
  loops: [],
};

export class AgentLoopStore {
  private loops = new Map<string, AgentLoopDefinition>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as AgentLoopStoreFile;
      this.loops = new Map(parsed.loops.map((loop) => [loop.id, loop]));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.loops = new Map();
      await this.flush();
    }
    this.loaded = true;
  }

  getAll(): AgentLoopDefinition[] {
    return [...this.loops.values()].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      if (a.nextRunAt !== b.nextRunAt) return a.nextRunAt - b.nextRunAt;
      return a.id.localeCompare(b.id);
    });
  }

  get(id: string): AgentLoopDefinition | undefined {
    return this.loops.get(id);
  }

  async upsert(loop: AgentLoopDefinition): Promise<void> {
    this.loops.set(loop.id, loop);
    await this.flush();
  }

  async remove(id: string): Promise<void> {
    if (!this.loops.has(id)) {
      return;
    }
    this.loops.delete(id);
    await this.flush();
  }

  private async flush(): Promise<void> {
    const payload: AgentLoopStoreFile = {
      ...EMPTY_STORE,
      loops: this.getAll(),
    };
    await atomicFileWrite(this.filePath, JSON.stringify(payload, null, 2));
  }
}
