/**
 * sessionStoreRpc — filesystem-backed session store tests.
 *
 * The module reads JSONL files under `${CLAUDE_CONFIG_DIR}/projects/<cwd-encoded>/`.
 * Each test sets up a private temp dir, points `CLAUDE_CONFIG_DIR` at it,
 * writes a small synthesised JSONL fixture, and asserts on the output of
 * the public functions. No real `~/.claude` interaction.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  listSessions,
  getSessionInfo,
  deleteSession,
  renameSession,
  getSessionMessages,
} from "./sessionStoreRpc";

const SID_A = "11111111-2222-3333-4444-555555555555";
const SID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SID_AGENT = "agent-foo-bar"; // must be filtered out (non-UUID)

/**
 * Encode a working directory to its on-disk project-folder name,
 * matching `utils/path.ts` (`resolve(cwd).replace(/[^a-zA-Z0-9-]/g, '-')`).
 */
function encodeCwd(cwd: string): string {
  return resolve(cwd).replace(/[^a-zA-Z0-9-]/g, "-");
}

interface Fixture {
  /** Sandbox root used as CLAUDE_CONFIG_DIR for the test. */
  root: string;
  /** Synthetic working directory whose encoded form is the project dir. */
  cwd: string;
  /** Absolute path to the project dir. */
  projectDir: string;
  /** Write a JSONL file under the project dir; returns the absolute path. */
  writeJsonl(sessionId: string, records: unknown[]): string;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "sess-store-"));
  process.env.CLAUDE_CONFIG_DIR = root;

  const cwd = "/tmp/proj-fixture-1";
  const projectDir = join(root, "projects", encodeCwd(cwd));
  mkdirSync(projectDir, { recursive: true });

  return {
    root,
    cwd,
    projectDir,
    writeJsonl(sessionId, records) {
      const path = join(projectDir, sessionId + ".jsonl");
      const text = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
      writeFileSync(path, text, "utf8");
      return path;
    },
  };
}

let savedEnv: string | undefined;
let fx: Fixture;

beforeEach(() => {
  savedEnv = process.env.CLAUDE_CONFIG_DIR;
  fx = makeFixture();
});

afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = savedEnv;
  }
  try {
    rmSync(fx.root, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("sessionStoreRpc.listSessions", () => {
  it("returns empty when project root does not exist", async () => {
    rmSync(join(fx.root, "projects"), { recursive: true });
    const out = await listSessions();
    expect(out).toEqual([]);
  });

  it("lists sessions in the given dir; UUID-only filenames", async () => {
    fx.writeJsonl(SID_A, [
      {
        type: "user",
        uuid: "u1",
        sessionId: SID_A,
        message: { role: "user", content: "hello" },
        cwd: fx.cwd,
        gitBranch: "main",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
    // Non-UUID filename must be skipped.
    writeFileSync(
      join(fx.projectDir, SID_AGENT + ".jsonl"),
      JSON.stringify({ type: "user", uuid: "u1", message: { content: "x" } }) + "\n",
      "utf8",
    );

    const out = await listSessions({ dir: fx.cwd });
    expect(out).toHaveLength(1);
    expect(out[0].sessionId).toBe(SID_A);
    expect(out[0].cwd).toBe(fx.cwd);
    expect(out[0].gitBranch).toBe("main");
    expect(out[0].firstPrompt).toBe("hello");
    expect(out[0].summary).toBe("hello");
    expect(out[0].fileSize).toBeGreaterThan(0);
  });

  it("orders by mtime desc; applies offset+limit", async () => {
    fx.writeJsonl(SID_A, [
      { type: "user", uuid: "ua", sessionId: SID_A, message: { content: "A" } },
    ]);
    const pb = fx.writeJsonl(SID_B, [
      { type: "user", uuid: "ub", sessionId: SID_B, message: { content: "B" } },
    ]);

    // Make pb older than pa: SID_A must come first.
    const past = new Date("2020-01-01T00:00:00Z");
    utimesSync(pb, past, past);

    const all = await listSessions({ dir: fx.cwd });
    expect(all.map((s) => s.sessionId)).toEqual([SID_A, SID_B]);

    const limited = await listSessions({ dir: fx.cwd, limit: 1 });
    expect(limited.map((s) => s.sessionId)).toEqual([SID_A]);

    const offsetOne = await listSessions({ dir: fx.cwd, offset: 1 });
    expect(offsetOne.map((s) => s.sessionId)).toEqual([SID_B]);
  });

  it("picks customTitle from the last custom-title record", async () => {
    fx.writeJsonl(SID_A, [
      { type: "user", uuid: "u1", sessionId: SID_A, message: { content: "first" } },
      { type: "custom-title", sessionId: SID_A, customTitle: "v1" },
      { type: "custom-title", sessionId: SID_A, customTitle: "v2-latest" },
    ]);
    const info = await getSessionInfo(SID_A, { dir: fx.cwd });
    expect(info?.customTitle).toBe("v2-latest");
  });

  it("uses summary record over firstPrompt when both present", async () => {
    fx.writeJsonl(SID_A, [
      { type: "summary", summary: "explicit summary" },
      { type: "user", uuid: "u1", sessionId: SID_A, message: { content: "first user text" } },
    ]);
    const info = await getSessionInfo(SID_A, { dir: fx.cwd });
    expect(info?.summary).toBe("explicit summary");
    expect(info?.firstPrompt).toBe("first user text");
  });

  it("extracts firstPrompt from array-of-parts content", async () => {
    fx.writeJsonl(SID_A, [
      {
        type: "user",
        uuid: "u1",
        sessionId: SID_A,
        message: {
          role: "user",
          content: [{ type: "text", text: "structured prompt" }],
        },
      },
    ]);
    const info = await getSessionInfo(SID_A, { dir: fx.cwd });
    expect(info?.firstPrompt).toBe("structured prompt");
    expect(info?.summary).toBe("structured prompt");
  });

  it("survives malformed JSONL lines", async () => {
    const path = join(fx.projectDir, SID_A + ".jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({ type: "user", uuid: "u1", sessionId: SID_A, message: { content: "ok" } }),
        "{not-json,broken",
        "",
        JSON.stringify({ type: "custom-title", sessionId: SID_A, customTitle: "T" }),
      ].join("\n"),
      "utf8",
    );
    const info = await getSessionInfo(SID_A, { dir: fx.cwd });
    expect(info?.firstPrompt).toBe("ok");
    expect(info?.customTitle).toBe("T");
  });
});

describe("sessionStoreRpc.getSessionInfo", () => {
  it("returns null when session id is unknown", async () => {
    const out = await getSessionInfo(SID_A, { dir: fx.cwd });
    expect(out).toBeNull();
  });

  it("works without dir by scanning all project dirs", async () => {
    fx.writeJsonl(SID_A, [
      { type: "user", uuid: "u1", sessionId: SID_A, message: { content: "x" } },
    ]);
    const info = await getSessionInfo(SID_A);
    expect(info?.sessionId).toBe(SID_A);
  });
});

describe("sessionStoreRpc.deleteSession", () => {
  it("removes the JSONL file", async () => {
    const path = fx.writeJsonl(SID_A, [
      { type: "user", uuid: "u1", sessionId: SID_A, message: { content: "x" } },
    ]);
    expect(existsSync(path)).toBe(true);

    await deleteSession(SID_A, { dir: fx.cwd });
    expect(existsSync(path)).toBe(false);
  });

  it("is idempotent for missing sessions", async () => {
    // Should not throw.
    await expect(deleteSession(SID_A, { dir: fx.cwd })).resolves.toBeUndefined();
  });
});

describe("sessionStoreRpc.renameSession", () => {
  it("appends a custom-title record", async () => {
    const path = fx.writeJsonl(SID_A, [
      { type: "user", uuid: "u1", sessionId: SID_A, message: { content: "x" } },
    ]);

    await renameSession(SID_A, "New Title", { dir: fx.cwd });

    const lines = readFileSync(path, "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last).toEqual({
      type: "custom-title",
      customTitle: "New Title",
      sessionId: SID_A,
    });

    const info = await getSessionInfo(SID_A, { dir: fx.cwd });
    expect(info?.customTitle).toBe("New Title");
  });

  it("throws for unknown session", async () => {
    await expect(renameSession(SID_A, "t", { dir: fx.cwd })).rejects.toThrow(
      /Session not found/,
    );
  });
});

describe("sessionStoreRpc.getSessionMessages", () => {
  it("returns user+assistant by default; system filtered out", async () => {
    fx.writeJsonl(SID_A, [
      { type: "user", uuid: "u1", sessionId: SID_A, message: { content: "hi" } },
      { type: "assistant", uuid: "a1", sessionId: SID_A, message: { content: [{ type: "text", text: "hello" }] } },
      { type: "system", uuid: "s1", sessionId: SID_A, message: { content: "init" } },
      { type: "custom-title", sessionId: SID_A, customTitle: "T" }, // ignored
    ]);

    const msgs = await getSessionMessages(SID_A, { dir: fx.cwd });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ type: "user", uuid: "u1", session_id: SID_A });
    expect(msgs[1]).toMatchObject({ type: "assistant", uuid: "a1", session_id: SID_A });
  });

  it("includes system messages when requested", async () => {
    fx.writeJsonl(SID_A, [
      { type: "user", uuid: "u1", sessionId: SID_A, message: { content: "hi" } },
      { type: "system", uuid: "s1", sessionId: SID_A, message: { content: "init" } },
    ]);
    const msgs = await getSessionMessages(SID_A, {
      dir: fx.cwd,
      includeSystemMessages: true,
    });
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.type)).toEqual(["user", "system"]);
  });

  it("offset + limit pagination", async () => {
    fx.writeJsonl(SID_A, [
      { type: "user", uuid: "u1", sessionId: SID_A, message: { content: "1" } },
      { type: "assistant", uuid: "a1", sessionId: SID_A, message: { content: "2" } },
      { type: "user", uuid: "u2", sessionId: SID_A, message: { content: "3" } },
      { type: "assistant", uuid: "a2", sessionId: SID_A, message: { content: "4" } },
    ]);

    const page = await getSessionMessages(SID_A, {
      dir: fx.cwd,
      offset: 1,
      limit: 2,
    });
    expect(page.map((m) => m.uuid)).toEqual(["a1", "u2"]);
  });

  it("returns [] for missing session", async () => {
    const msgs = await getSessionMessages(SID_A, { dir: fx.cwd });
    expect(msgs).toEqual([]);
  });
});
