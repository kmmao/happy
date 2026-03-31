import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomationStore } from "./AutomationStore";
import type { AutomationJob } from "./types";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("AutomationStore", () => {
  it("persists and reloads jobs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-automation-store-"));
    tempDirs.push(dir);
    const filePath = join(dir, "jobs.json");

    const store = new AutomationStore(filePath);
    await store.load();

    const job: AutomationJob = {
      id: "job-1",
      kind: "webhook",
      status: "queued",
      priority: "background",
      dedupeKey: "webhook:1",
      attempt: 0,
      maxAttempts: 3,
      createdAt: 1,
      updatedAt: 1,
      payload: {
        type: "webhook-trigger",
        webhookEventId: "1",
        issueNumber: 1,
        issueTitle: "Issue",
        issueBody: "Body",
        issueAuthor: "alice",
        issueLabels: [],
        issueUrl: "https://example.com/issues/1",
        repoUrl: "https://example.com/repo.git",
        repoPath: "/tmp/repo",
        provider: "github",
      },
    };

    await store.upsert(job);

    const reloaded = new AutomationStore(filePath);
    await reloaded.load();

    expect(reloaded.getAll()).toEqual([job]);
  });
});
