import { beforeEach, describe, expect, it, vi } from "vitest";

const { machineRPCMock, sessionRPCMock, storageState } = vi.hoisted(() => ({
  machineRPCMock: vi.fn(),
  sessionRPCMock: vi.fn(),
  storageState: {
    sessions: {} as Record<string, { rpcReady: boolean } | undefined>,
    settings: {
      knowledgeBase: false,
      knowledgeBaseMode: "off",
      knowledgeBaseSensitivity: "balanced",
      knowledgeBaseTrackFileEdits: false,
      knowledgeBaseTrackToolCalls: false,
      knowledgeBaseTrackTokens: false,
    },
  },
}));

vi.mock("./apiSocket", () => ({
  apiSocket: {
    sessionRPC: sessionRPCMock,
    machineRPC: machineRPCMock,
  },
}));

vi.mock("./storage", () => ({
  storage: {
    getState: () => storageState,
  },
}));

vi.mock("./sync", () => ({
  sync: {},
}));

import {
  machineCleanRunawayProcesses,
  machineSpawnNewSession,
  sessionBash,
  sessionKill,
  sessionListDirectory,
  sessionReadFile,
} from "./ops";

describe("ops session RPC guards", () => {
  beforeEach(() => {
    machineRPCMock.mockReset();
    sessionRPCMock.mockReset();
    storageState.sessions = {};
  });

  it("会在 session RPC 未 ready 时短路 sessionBash", async () => {
    storageState.sessions["session-1"] = { rpcReady: false };

    const result = await sessionBash("session-1", { command: "pwd" });

    expect(result).toEqual({
      success: false,
      stdout: "",
      stderr: "Session RPC not ready",
      exitCode: -1,
      error: "Session RPC not ready",
    });
    expect(sessionRPCMock).not.toHaveBeenCalled();
  });

  it("会在 session RPC 未 ready 时短路 sessionKill", async () => {
    storageState.sessions["session-1"] = { rpcReady: false };

    const result = await sessionKill("session-1");

    expect(result).toEqual({
      success: false,
      message: "Session RPC not ready",
    });
    expect(sessionRPCMock).not.toHaveBeenCalled();
  });

  it("会在 session 不存在时短路文件读取", async () => {
    const result = await sessionReadFile("missing-session", "/tmp/demo.txt");

    expect(result).toEqual({
      success: false,
      error: "Session not found",
    });
    expect(sessionRPCMock).not.toHaveBeenCalled();
  });

  it("会在 session RPC ready 时继续发起目录读取 RPC", async () => {
    storageState.sessions["session-2"] = { rpcReady: true };
    sessionRPCMock.mockResolvedValue({
      success: true,
      entries: [{ name: "src", type: "directory" }],
    });

    const result = await sessionListDirectory("session-2", "/repo");

    expect(sessionRPCMock).toHaveBeenCalledWith("session-2", "listDirectory", {
      path: "/repo",
    });
    expect(result).toEqual({
      success: true,
      entries: [{ name: "src", type: "directory" }],
    });
  });

  it("会在 session RPC ready 时继续发起 sessionKill RPC", async () => {
    storageState.sessions["session-2"] = { rpcReady: true };
    sessionRPCMock.mockResolvedValue({
      success: true,
      message: "killed",
    });

    const result = await sessionKill("session-2");

    expect(sessionRPCMock).toHaveBeenCalledWith("session-2", "killSession", {});
    expect(result).toEqual({
      success: true,
      message: "killed",
    });
  });

  it("会在 runtime profile 非法时短路 machineSpawnNewSession", async () => {
    const result = await machineSpawnNewSession({
      machineId: "machine-1",
      directory: "/repo",
      runtimeProfile: {
        schemaVersion: 999,
        source: "account-profile",
        trust: "trusted",
        environmentVariables: {},
      } as any,
    });

    expect(result).toEqual({
      type: "error",
      errorMessage: "Runtime profile payload is invalid or unsupported",
    });
    expect(machineRPCMock).not.toHaveBeenCalled();
  });

  it("会在 runtime profile 合法时标准化后继续发起 machine RPC", async () => {
    machineRPCMock.mockResolvedValue({
      type: "success",
      sessionId: "session-3",
    });

    const result = await machineSpawnNewSession({
      machineId: "machine-1",
      directory: "/repo",
      runtimeProfile: {
        profileId: "profile-1",
        profileName: "Profile 1",
        source: "account-profile",
        trust: "trusted",
        environmentVariables: {
          OPENAI_API_KEY: "sk-test",
        },
      } as any,
    });

    expect(machineRPCMock).toHaveBeenCalledWith(
      "machine-1",
      "spawn-happy-session",
      expect.objectContaining({
        profileId: "profile-1",
        runtimeProfile: expect.objectContaining({
          schemaVersion: 1,
          profileId: "profile-1",
          profileName: "Profile 1",
          source: "account-profile",
          trust: "trusted",
        }),
      }),
    );
    expect(result).toEqual({
      type: "success",
      sessionId: "session-3",
    });
  });

  it("会通过专用 machine RPC 清理 runaway 进程", async () => {
    machineRPCMock.mockResolvedValue({
      success: true,
      killed: 2,
      errors: [],
    });

    const result = await machineCleanRunawayProcesses("machine-1");

    expect(machineRPCMock).toHaveBeenCalledWith("machine-1", "doctor-clean", {});
    expect(result).toEqual({
      success: true,
      killed: 2,
      errors: [],
    });
  });
});
