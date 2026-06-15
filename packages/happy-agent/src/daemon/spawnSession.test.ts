import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawn, mockExecFile, mockStat, mockTrackSession } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecFile: vi.fn(),
  mockStat: vi.fn(),
  mockTrackSession: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: mockSpawn,
  execFile: mockExecFile,
}));

vi.mock("fs/promises", () => ({
  stat: mockStat,
  mkdir: vi.fn(),
}));

vi.mock("./trackedSessions", () => ({
  trackSession: mockTrackSession,
  untrackSession: vi.fn(),
}));

vi.mock("../logger", () => ({
  logger: {
    debug: vi.fn(),
  },
}));

function makeChildProcess() {
  return {
    pid: 1234,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    unref: vi.fn(),
  };
}

describe("spawnSession", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockExecFile.mockImplementation((_cmd, _args, callback) => {
      callback(null, { stdout: "/usr/local/bin/happy\n" });
    });
    mockStat.mockResolvedValue({ isDirectory: () => true });
    mockSpawn.mockReturnValue(makeChildProcess());
  });

  it("passes --resume for claude spawns with a source session id", async () => {
    const { spawnSession } = await import("./spawnSession");

    const result = await spawnSession({
      directory: "/repo",
      agent: "claude",
      sessionId: "93a9705e-bc6a-406d-8dce-8acc014dedbd",
      happySessionId: "happy-session",
    });

    expect(result).toMatchObject({ type: "success", pid: 1234 });
    expect(mockSpawn).toHaveBeenCalledWith(
      "/usr/local/bin/happy",
      [
        "claude",
        "--happy-starting-mode",
        "remote",
        "--started-by",
        "daemon",
        "--resume",
        "93a9705e-bc6a-406d-8dce-8acc014dedbd",
        "--happy-session-id",
        "happy-session",
      ],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  it("does not pass --resume to non-claude agents", async () => {
    const { spawnSession } = await import("./spawnSession");

    await spawnSession({
      directory: "/repo",
      agent: "codex",
      sessionId: "93a9705e-bc6a-406d-8dce-8acc014dedbd",
    });

    expect(mockSpawn.mock.calls[0][1]).not.toContain("--resume");
  });
});
