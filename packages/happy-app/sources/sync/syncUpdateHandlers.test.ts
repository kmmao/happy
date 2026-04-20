import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const storageState = {
    sessions: {} as Record<string, any>,
    settings: {
      webNotifications: false,
      webNotificationsPersistent: false,
    },
    getPendingSessionPreferences: vi.fn(() => null),
  };

  return {
    storageState,
    getStateMock: vi.fn(() => storageState),
    invalidateGitStatusMock: vi.fn(),
    applySessionsMock: vi.fn(),
    fetchSessionsMock: vi.fn(),
    onPermissionRequestedMock: vi.fn(),
    mergeUpdatedSessionMock: vi.fn(),
  };
});

vi.mock("react-native", () => ({
  Platform: {
    OS: "web",
  },
}));

vi.mock("./storage", () => ({
  storage: {
    getState: mocks.getStateMock,
  },
}));

vi.mock("./gitStatusSync", () => ({
  gitStatusSync: {
    invalidate: mocks.invalidateGitStatusMock,
    clearForSession: vi.fn(),
  },
}));

vi.mock("./projectManager", () => ({
  projectManager: {
    removeSession: vi.fn(),
  },
  createProjectKey: vi.fn(),
}));

vi.mock("./gitWorktreeOps", () => ({
  removeWorktree: vi.fn(),
}));

vi.mock("./issueSessionStore", () => ({
  issueSessionStore: {
    getState: () => ({
      findBySessionId: vi.fn(),
      updateStatus: vi.fn(),
    }),
  },
}));

vi.mock("./encryption/encryption", () => ({
  Encryption: class {},
}));

vi.mock("./encryption/sessionEncryption", () => ({
  SessionEncryption: class {},
}));

vi.mock("./encryption/artifactEncryption", () => ({
  ArtifactEncryption: class {},
}));

vi.mock("./issueSessionTypes", () => ({
  isIssueSessionKey: vi.fn(),
}));

vi.mock("./syncIssueHandlers", () => ({
  handleIssueSessionCompletion: vi.fn(),
}));

vi.mock("./messageCache", () => ({
  deleteMessageCache: vi.fn(),
}));

vi.mock("./syncHelpers", () => ({
  detectNeedsAttention: vi.fn(),
}));

vi.mock("./updateSessionMerge", () => ({
  mergeUpdatedSession: mocks.mergeUpdatedSessionMock,
}));

vi.mock("@/realtime/hooks/voiceHooks", () => ({
  voiceHooks: {
    onPermissionRequested: mocks.onPermissionRequestedMock,
  },
}));

vi.mock("@/text", () => ({
  t: vi.fn((key: string) => key),
}));

vi.mock("@/utils/sessionUtils", () => ({
  getSessionName: vi.fn(() => "Session"),
}));

vi.mock("@/utils/webNotification", () => ({
  notifyTaskComplete: vi.fn(),
  notifyPermissionRequest: vi.fn(),
  clearNotifiedRequests: vi.fn(),
}));

vi.mock("@/log", () => ({
  log: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { handleUpdateSessionUpdate } from "./syncUpdateHandlers";

describe("handleUpdateSessionUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.storageState.sessions = {
      "session-1": {
        id: "session-1",
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        rpcReady: true,
        metadata: {
          path: "/repo",
          machineId: "machine-1",
        },
        metadataVersion: 1,
        agentState: {},
        agentStateVersion: 1,
        preferencesVersion: 0,
        thinking: false,
        thinkingAt: 0,
        presence: "online",
        needsAttention: false,
        permissionMode: "default",
        modelMode: "default",
        draft: null,
      },
    };

    mocks.mergeUpdatedSessionMock.mockReturnValue({
      updatedSession: {
        ...mocks.storageState.sessions["session-1"],
        agentState: {},
        agentStateVersion: 2,
        seq: 9,
        updatedAt: 999,
      },
      metadataDecryptFailed: false,
    });
  });

  it("不会因为纯 agentState 更新就触发 git 状态刷新", async () => {
    const decryptAgentState = vi.fn().mockResolvedValue({});
    const decryptMetadata = vi.fn();
    const decryptPreferences = vi.fn();

    await handleUpdateSessionUpdate(
      {
        seq: 9,
        createdAt: 999,
      } as any,
      {
        t: "update-session",
        id: "session-1",
        agentState: {
          version: 2,
          value: "encrypted-agent-state",
        },
      } as any,
      {
        encryption: {
          getSessionEncryption: vi.fn(() => ({
            decryptAgentState,
            decryptMetadata,
            decryptPreferences,
          })),
        },
        applySessions: mocks.applySessionsMock,
        fetchSessions: mocks.fetchSessionsMock,
      } as any,
    );

    expect(mocks.applySessionsMock).toHaveBeenCalledTimes(1);
    expect(decryptAgentState).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateGitStatusMock).not.toHaveBeenCalled();
    expect(mocks.onPermissionRequestedMock).not.toHaveBeenCalled();
  });
});
