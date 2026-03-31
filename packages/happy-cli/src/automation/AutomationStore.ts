import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicFileWrite } from "@/utils/fileAtomic";
import type {
  AutomationJob,
  AutomationStoreFile,
} from "./types";

const EMPTY_STORE: AutomationStoreFile = {
  version: 1,
  jobs: [],
};

export class AutomationStore {
  private jobs = new Map<string, AutomationJob>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as AutomationStoreFile;
      this.jobs = new Map(parsed.jobs.map((job) => [job.id, job]));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.jobs = new Map();
      await this.flush();
    }

    this.loaded = true;
  }

  getAll(): AutomationJob[] {
    return [...this.jobs.values()].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id.localeCompare(b.id);
    });
  }

  get(id: string): AutomationJob | undefined {
    return this.jobs.get(id);
  }

  findActiveByDedupeKey(dedupeKey: string): AutomationJob | undefined {
    return this.getAll().find(
      (job) =>
        job.dedupeKey === dedupeKey &&
        job.status !== "completed" &&
        job.status !== "failed" &&
        job.status !== "cancelled",
    );
  }

  async upsert(job: AutomationJob): Promise<void> {
    this.jobs.set(job.id, job);
    await this.flush();
  }

  async remove(id: string): Promise<void> {
    this.jobs.delete(id);
    await this.flush();
  }

  private async flush(): Promise<void> {
    const payload: AutomationStoreFile = {
      ...EMPTY_STORE,
      jobs: this.getAll(),
    };
    await atomicFileWrite(this.filePath, JSON.stringify(payload, null, 2));
  }
}
