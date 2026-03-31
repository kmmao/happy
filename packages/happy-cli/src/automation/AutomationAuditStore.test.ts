import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomationAuditStore } from "./AutomationAuditStore";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("AutomationAuditStore", () => {
  it("persists and reloads recent events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-automation-audit-"));
    tempDirs.push(dir);

    const filePath = join(dir, "audit.json");
    const store = new AutomationAuditStore(filePath, 2);
    await store.load();
    await store.append({ id: "1", occurredAt: 100, kind: "job_enqueued" });
    await store.append({ id: "2", occurredAt: 200, kind: "guardian_remembered", guardianKey: "loop:1" });
    await store.append({ id: "3", occurredAt: 300, kind: "guardian_reused", guardianKey: "loop:1" });

    expect(store.getAll().map((event) => event.id)).toEqual(["3", "2"]);

    const reloaded = new AutomationAuditStore(filePath, 2);
    await reloaded.load();
    expect(reloaded.getAll().map((event) => event.id)).toEqual(["3", "2"]);

    await reloaded.clear();
    expect(reloaded.getAll()).toEqual([]);

    const emptied = new AutomationAuditStore(filePath, 2);
    await emptied.load();
    expect(emptied.getAll()).toEqual([]);
  });
});
