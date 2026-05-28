import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrackedSessionRegistry, fromPersistedTrackedSession, toPersistedTrackedSession } from "./TrackedSessionRegistry";
import type { PersistedTrackedSession } from "./TrackedSessionRegistry";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function makeTempRegistryPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "happy-tracked-session-registry-"));
  tempDirs.push(dir);
  return join(dir, "tracked-sessions.json");
}

describe("TrackedSessionRegistry", () => {
  it("persists daemon tracked sessions with session ids", async () => {
    const path = await makeTempRegistryPath();
    const registry = new TrackedSessionRegistry(path);
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

    const reloaded = new TrackedSessionRegistry(path);
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

  it("toPersistedTrackedSession accepts spawnId without happySessionId", async () => {
    const persisted = toPersistedTrackedSession({
      startedBy: "daemon",
      pid: 99,
      spawnId: "sp-abc",
      startedAt: 1000,
    });
    expect(persisted).toMatchObject({ spawnId: "sp-abc", pid: 99 });
    expect(persisted!.happySessionId).toBeUndefined();
  });

  it("toPersistedTrackedSession returns undefined when neither id is present", async () => {
    const persisted = toPersistedTrackedSession({
      startedBy: "daemon",
      pid: 99,
      startedAt: 1000,
    });
    expect(persisted).toBeUndefined();
  });

  it("persists pending entries keyed by spawnId (before /session-started)", async () => {
    const path = await makeTempRegistryPath();
    const registry = new TrackedSessionRegistry(path);
    await registry.load();

    await registry.rememberTrackedSession({
      startedBy: "daemon",
      pid: 42,
      spawnId: "sp-pending",
      startedAt: 500,
    });

    const reloaded = new TrackedSessionRegistry(path);
    await reloaded.load();
    const entry = reloaded.getBySpawnId("sp-pending");
    expect(entry).toMatchObject({ spawnId: "sp-pending", pid: 42 });
    expect(entry!.happySessionId).toBeUndefined();
  });

  it("keeps spawn: primary key stable after happySessionId is learned", async () => {
    const path = await makeTempRegistryPath();
    const registry = new TrackedSessionRegistry(path);
    await registry.load();

    await registry.rememberTrackedSession({
      startedBy: "daemon",
      pid: 42,
      spawnId: "sp-stable",
      startedAt: 500,
    });

    // Learn session id — emulate /session-started webhook upgrade.
    await registry.rememberTrackedSession({
      startedBy: "daemon",
      pid: 42,
      spawnId: "sp-stable",
      happySessionId: "session-upgraded",
      startedAt: 500,
      lastActivityAt: 600,
    });

    // get() by session id must find the entry even though primary key is spawn:
    expect(registry.get("session-upgraded")).toMatchObject({
      spawnId: "sp-stable",
      happySessionId: "session-upgraded",
      pid: 42,
    });
    expect(registry.getBySpawnId("sp-stable")).toMatchObject({
      spawnId: "sp-stable",
      happySessionId: "session-upgraded",
    });
    // No duplicate entry under sess: key.
    expect(registry.getAll()).toHaveLength(1);
  });

  it("loads v1 schema files transparently and upgrades to v2 on flush", async () => {
    const path = await makeTempRegistryPath();
    // Seed a v1 file by hand — mimics an install prior to the heartbeat feature.
    const v1Payload = {
      version: 1 as const,
      sessions: [
        {
          happySessionId: "legacy-session",
          pid: 200,
          startedBy: "daemon",
          startedAt: 100,
          lastActivityAt: 200,
        },
      ],
    };
    await writeFile(path, JSON.stringify(v1Payload, null, 2));

    const registry = new TrackedSessionRegistry(path);
    await registry.load();

    expect(registry.get("legacy-session")).toMatchObject({
      happySessionId: "legacy-session",
      pid: 200,
    });

    // Any mutation triggers a v2 flush.
    await registry.upsert({
      happySessionId: "legacy-session",
      pid: 200,
      startedBy: "daemon",
      startedAt: 100,
      lastActivityAt: 300,
    });

    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(2);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0]).toMatchObject({
      happySessionId: "legacy-session",
      lastActivityAt: 300,
    });
  });

  it("forgetSession removes entries regardless of primary key style", async () => {
    const path = await makeTempRegistryPath();
    const registry = new TrackedSessionRegistry(path);
    await registry.load();

    // Entry A: external session (sess: key)
    await registry.upsert({
      happySessionId: "external-session",
      pid: 1,
      startedBy: "terminal",
      startedAt: 100,
    });
    // Entry B: daemon-spawned upgraded (spawn: key, with happySessionId as secondary)
    await registry.upsert({
      spawnId: "sp-xyz",
      happySessionId: "upgraded-session",
      pid: 2,
      startedBy: "daemon",
      startedAt: 200,
    });

    expect(registry.getAll()).toHaveLength(2);

    await registry.forgetSession("external-session");
    expect(registry.get("external-session")).toBeUndefined();
    expect(registry.getAll()).toHaveLength(1);

    await registry.forgetSession("upgraded-session");
    expect(registry.get("upgraded-session")).toBeUndefined();
    expect(registry.getBySpawnId("sp-xyz")).toBeUndefined();
    expect(registry.getAll()).toHaveLength(0);
  });

  it("forgetSpawn removes entries keyed by spawnId", async () => {
    const path = await makeTempRegistryPath();
    const registry = new TrackedSessionRegistry(path);
    await registry.load();

    await registry.upsert({
      spawnId: "sp-to-forget",
      pid: 7,
      startedBy: "daemon",
      startedAt: 100,
    });
    expect(registry.getBySpawnId("sp-to-forget")).toBeDefined();

    await registry.forgetSpawn("sp-to-forget");
    expect(registry.getBySpawnId("sp-to-forget")).toBeUndefined();
  });

  it("drops entries without spawnId or happySessionId on load", async () => {
    const path = await makeTempRegistryPath();
    // Seed a malformed file — can happen if an old buggy daemon version wrote
    // a record without either id. Loader must skip these silently rather than
    // blow up or key them under undefined.
    const malformed = {
      version: 2,
      sessions: [
        { pid: 11, startedBy: "daemon", startedAt: 100 },
        { spawnId: "sp-valid", pid: 12, startedBy: "daemon", startedAt: 100 },
      ],
    };
    await writeFile(path, JSON.stringify(malformed));

    const registry = new TrackedSessionRegistry(path);
    await registry.load();

    const entries = registry.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ spawnId: "sp-valid" });
  });

  it("sort order prefers lastHeartbeatAt over lastActivityAt over startedAt", async () => {
    const path = await makeTempRegistryPath();
    const registry = new TrackedSessionRegistry(path);
    await registry.load();

    await registry.upsert({
      happySessionId: "oldest",
      pid: 1,
      startedBy: "terminal",
      startedAt: 100,
    });
    await registry.upsert({
      happySessionId: "newer-activity",
      pid: 2,
      startedBy: "terminal",
      startedAt: 50,
      lastActivityAt: 200,
    });
    await registry.upsert({
      happySessionId: "newest-heartbeat",
      pid: 3,
      startedBy: "terminal",
      startedAt: 10,
      lastActivityAt: 150,
      lastHeartbeatAt: 300,
    });

    const ids = registry.getAll().map((e) => e.happySessionId);
    expect(ids).toEqual(["newest-heartbeat", "newer-activity", "oldest"]);
  });

  it("handles concurrent upserts from distinct entries independently", async () => {
    const path = await makeTempRegistryPath();
    const registry = new TrackedSessionRegistry(path);
    await registry.load();

    await Promise.all([
      registry.upsert({ spawnId: "sp-a", pid: 1, startedBy: "daemon", startedAt: 100 }),
      registry.upsert({ spawnId: "sp-b", pid: 2, startedBy: "daemon", startedAt: 100 }),
    ]);

    const reloaded = new TrackedSessionRegistry(path);
    await reloaded.load();
    expect(reloaded.getBySpawnId("sp-a")).toBeDefined();
    expect(reloaded.getBySpawnId("sp-b")).toBeDefined();
  });
});

describe("fromPersistedTrackedSession", () => {
  const persisted: PersistedTrackedSession = {
    spawnId: "sp-recover",
    pid: 1000,
    startedBy: "daemon",
    startedAt: 100,
    lastActivityAt: 200,
    lastOutputAt: 250,
    lastHeartbeatAt: 300,
    activity: "thinking",
    automationContext: { kind: "agent_loop", loopId: "loop-9" },
    tmuxSessionId: "session:9",
    directoryCreated: true,
    message: "pending",
  };

  it("restores lastHeartbeatAt and activity (the fields the old inline reconstruction dropped)", () => {
    const session = fromPersistedTrackedSession(persisted, 2000);
    expect(session.lastHeartbeatAt).toBe(300);
    expect(session.activity).toBe("thinking");
  });

  it("uses the caller-supplied pid, not the stale persisted pid", () => {
    const session = fromPersistedTrackedSession(persisted, 2000);
    expect(session.pid).toBe(2000);
  });

  it("flags the result as recovered from the on-disk index", () => {
    const before = Date.now();
    const session = fromPersistedTrackedSession(persisted, 2000);
    expect(session.recoveredFromIndex).toBe(true);
    expect(session.recoveredAt).toBeGreaterThanOrEqual(before);
  });

  it("round-trips every persisted field through toPersistedTrackedSession (pid aside)", () => {
    const reconstructed = fromPersistedTrackedSession(persisted, 2000);
    const rePersisted = toPersistedTrackedSession(reconstructed);
    expect(rePersisted).toEqual({ ...persisted, pid: 2000 });
  });
});

describe("recoverBySpawnId", () => {
  it("returns undefined when no persisted entry matches the spawnId", async () => {
    const path = await makeTempRegistryPath();
    const registry = new TrackedSessionRegistry(path);
    await registry.load();
    expect(registry.recoverBySpawnId("sp-missing", 2000)).toBeUndefined();
  });

  it("rebuilds a live TrackedSession from a persisted pending spawn", async () => {
    const path = await makeTempRegistryPath();
    const registry = new TrackedSessionRegistry(path);
    await registry.load();
    await registry.upsert({
      spawnId: "sp-pending",
      pid: 1000,
      startedBy: "daemon",
      startedAt: 100,
      lastHeartbeatAt: 300,
      activity: "executing",
    });

    const recovered = registry.recoverBySpawnId("sp-pending", 2000);
    expect(recovered).toMatchObject({
      spawnId: "sp-pending",
      startedBy: "daemon",
      pid: 2000,
      lastHeartbeatAt: 300,
      activity: "executing",
      recoveredFromIndex: true,
    });
  });
});
