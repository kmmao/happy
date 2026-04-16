import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  applyGitStatusMock,
  getProjectForSessionMock,
  mockState,
  sessionBashMock,
  updateProjectGitStatusMock,
} = vi.hoisted(() => ({
  applyGitStatusMock: vi.fn(),
  getProjectForSessionMock: vi.fn(),
  mockState: {
    applyGitStatus: vi.fn(),
    sessions: {} as Record<string, any>,
  },
  sessionBashMock: vi.fn(),
  updateProjectGitStatusMock: vi.fn(),
}));

vi.mock("./ops", () => ({
  sessionBash: sessionBashMock,
}));

vi.mock("./storage", () => ({
  storage: {
    getState: () => mockState,
  },
}));

vi.mock("./projectManager", () => ({
  createProjectKey: (machineId: string, path: string) => `${machineId}:${path}`,
  projectManager: {
    clearSubmodulesLastUpdated: vi.fn(),
    getProjectForSession: getProjectForSessionMock,
    updateProjectGitStatus: updateProjectGitStatusMock,
  },
}));

vi.mock("./git-parsers/parseStatus", () => ({
  parseStatusSummary: vi.fn(),
  getStatusCounts: vi.fn(),
  isDirty: vi.fn(),
}));

vi.mock("./git-parsers/parseStatusV2", () => ({
  getCurrentBranchV2: vi.fn(() => "main"),
  getStatusCountsV2: vi.fn(() => ({
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    untracked: 0,
    ignored: 0,
    conflicted: 0,
  })),
  getTrackingInfoV2: vi.fn(() => null),
  isDirtyV2: vi.fn(() => false),
  parseStatusSummaryV2: vi.fn(() => []),
}));

vi.mock("./git-parsers/parseBranch", () => ({
  parseCurrentBranch: vi.fn(() => "main"),
}));

vi.mock("./git-parsers/parseDiff", () => ({
  mergeDiffSummaries: vi.fn(() => ({
    stagedAdded: 0,
    stagedRemoved: 0,
    unstagedAdded: 0,
    unstagedRemoved: 0,
  })),
  parseNumStat: vi.fn(() => []),
}));

vi.mock("@/log", () => ({
  log: {
    error: vi.fn(),
  },
}));

import { GitStatusSync } from "./gitStatusSync";

function createSession(
  id: string,
  updatedAt: number,
  overrides: Partial<{
    active: boolean;
    activeAt: number;
    rpcReady: boolean;
    path: string;
  }> = {},
) {
  return {
    id,
    updatedAt,
    active: overrides.active ?? true,
    activeAt: overrides.activeAt ?? updatedAt,
    rpcReady: overrides.rpcReady ?? true,
    metadata: {
      machineId: "machine-1",
      path: overrides.path ?? "/repo",
    },
  };
}

describe("GitStatusSync", () => {
  beforeEach(() => {
    applyGitStatusMock.mockReset();
    getProjectForSessionMock.mockReset();
    sessionBashMock.mockReset();
    updateProjectGitStatusMock.mockReset();

    mockState.applyGitStatus = applyGitStatusMock;
    mockState.sessions = {};

    getProjectForSessionMock.mockImplementation(() => ({
      submodules: [],
      submodulesLastUpdatedAt: Date.now(),
    }));
  });

  it("会为已有项目级 sync 选择更新的可用 session", async () => {
    const now = Date.now();
    mockState.sessions = {
      "old-session": createSession("old-session", now - 10_000, {
        rpcReady: true,
      }),
      "new-session": createSession("new-session", now, {
        rpcReady: true,
      }),
    };

    sessionBashMock.mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "not a git repo",
      exitCode: 1,
    });

    const gitStatusSync = new GitStatusSync();

    gitStatusSync.getSync("old-session");
    gitStatusSync.getSync("new-session");
    await gitStatusSync.invalidateAndAwait("new-session");

    expect(sessionBashMock).toHaveBeenCalled();
    expect(sessionBashMock.mock.calls[0]?.[0]).toBe("new-session");
    expect(sessionBashMock.mock.calls[0]?.[1]).toMatchObject({
      command: "git rev-parse --is-inside-work-tree",
      cwd: "/repo",
    });
  });

  it("没有 rpcReady session 时不会继续发 git RPC", async () => {
    const now = Date.now();
    mockState.sessions = {
      "old-session": createSession("old-session", now - 10_000, {
        rpcReady: false,
      }),
      "new-session": createSession("new-session", now, {
        rpcReady: false,
      }),
    };

    const gitStatusSync = new GitStatusSync();

    gitStatusSync.getSync("old-session");
    gitStatusSync.getSync("new-session");
    await gitStatusSync.invalidateAndAwait("new-session");

    expect(sessionBashMock).not.toHaveBeenCalled();
  });
});
