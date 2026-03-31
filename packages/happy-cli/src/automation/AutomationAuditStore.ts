import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicFileWrite } from "@/utils/fileAtomic";
import type { AutomationAuditEvent, AutomationAuditStoreFile } from "./types";

const EMPTY_STORE: AutomationAuditStoreFile = {
  version: 1,
  events: [],
};

export class AutomationAuditStore {
  private events: AutomationAuditEvent[] = [];
  private loaded = false;

  constructor(
    private readonly filePath: string,
    private readonly maxEvents = 1000,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as AutomationAuditStoreFile;
      this.events = parsed.events ?? [];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.events = [];
      await this.flush();
    }
    this.loaded = true;
  }

  getAll(): AutomationAuditEvent[] {
    return this.events.slice().sort((a, b) => b.occurredAt - a.occurredAt);
  }

  async append(event: AutomationAuditEvent): Promise<void> {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(this.events.length - this.maxEvents);
    }
    await this.flush();
  }

  async clear(): Promise<void> {
    if (this.events.length === 0) {
      return;
    }
    this.events = [];
    await this.flush();
  }

  private async flush(): Promise<void> {
    const payload: AutomationAuditStoreFile = {
      ...EMPTY_STORE,
      events: this.events.slice().sort((a, b) => a.occurredAt - b.occurredAt),
    };
    await atomicFileWrite(this.filePath, JSON.stringify(payload, null, 2));
  }
}
