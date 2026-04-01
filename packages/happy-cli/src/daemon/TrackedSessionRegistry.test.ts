import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrackedSessionRegistry, toPersistedTrackedSession } from "./TrackedSessionRegistry";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("TrackedSessionRegistry", () => {
  it("persists daemon tracked sessions with session ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-tracked-session-registry-"));
    tempDirs.push(dir);
    const registry = new TrackedSessionRegistry(join(dir, "tracked-sessions.json"));
    await registry.load();

    const persisted = toPersistedTrackedSession({
      startedBy: "daemon",
      pid: 123,
      happySessionId: "session-1",
      startedAt: 100,
      lastActivityAt: 150,
      automationContext: {
        kind: "agent_loop",
        loopId: "loop-1",
        dedupeKey: "agent-loop:loop-1:1",
      },
      tmuxSessionId: "session:1",
      directoryCreated: true,
      message: "created",
    });

    expect(persisted).toMatchObject({
      happySessionId: "session-1",
      pid: 123,
      tmuxSessionId: "session:1",
    });

    await registry.upsert(persisted!);

    const reloaded = new TrackedSessionRegistry(join(dir, "tracked-sessions.json"));
    await reloaded.load();
    expect(reloaded.get("session-1")).toMatchObject({
      happySessionId: "session-1",
      pid: 123,
      automationContext: {
        kind: "agent_loop",
        loopId: "loop-1",
        dedupeKey: "agent-loop:loop-1:1",
      },
    });
  });
});
