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

vi.mock("react-native-mmkv", () => ({
  MMKV: class {
    getString() { return undefined; }
    set() {}
    delete() {}
    clearAll() {}
  },
}));

vi.mock("./serverConfig", () => ({
  getServerUrl: () => "http://localhost:3000",
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
  getLatestUserRequestPreview: vi.fn((messages) => {
    const message = messages[0];
    return message
      ? {
          text: message.text,
          isAutoOptionSend: message.meta?.source === "auto-option-send",
        }
      : null;
  }),
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

function makeBaselineSession() {
  return {
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
  };
}

let handleUpdateSessionUpdate: typeof import("./syncUpdateHandlers").handleUpdateSessionUpdate;

describe("handleUpdateSessionUpdate", () => {
  beforeEach(async () => {
  vi.clearAllMocks();

  handleUpdateSessionUpdate = (await import("./syncUpdateHandlers")).handleUpdateSessionUpdate;

  mocks.storageState.sessions = {
      "session-1": makeBaselineSession(),
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

  it("启动竞态下先等待 sessions 同步再重试,而非直接丢弃 (#80)", async () => {
    // 推送先于 sessions 同步到达:storage 里还没有该 session,encryption 也尚未就绪
    delete mocks.storageState.sessions["session-1"];

    const decryptAgentState = vi.fn().mockResolvedValue({});
    const sessionEncryption = {
      decryptAgentState,
      decryptMetadata: vi.fn(),
      decryptPreferences: vi.fn(),
    };

    // getSessionEncryption:第一次缺失,awaitQueue 之后才可用
    const getSessionEncryption = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValue(sessionEncryption);

    // awaitQueue:模拟正在进行的 sessions 同步落地,把 session 写回 storage
    const awaitQueue = vi.fn(async () => {
      mocks.storageState.sessions["session-1"] = makeBaselineSession();
    });

    await handleUpdateSessionUpdate(
      { seq: 9, createdAt: 999 } as any,
      {
        t: "update-session",
        id: "session-1",
        agentState: { version: 2, value: "encrypted-agent-state" },
      } as any,
      {
        encryption: { getSessionEncryption },
        applySessions: mocks.applySessionsMock,
        fetchSessions: mocks.fetchSessionsMock,
        sessionsSync: { invalidate: vi.fn(), awaitQueue },
      } as any,
    );

    expect(awaitQueue).toHaveBeenCalledTimes(1);
    expect(getSessionEncryption).toHaveBeenCalledTimes(2);
    expect(mocks.applySessionsMock).toHaveBeenCalledTimes(1);
    expect(mocks.fetchSessionsMock).not.toHaveBeenCalled();
  });

  it("等待 sessions 同步后仍缺失时,优雅回退到 refetch (#80)", async () => {
    // session 始终不存在,即使等待同步队列后也没有出现
    delete mocks.storageState.sessions["session-1"];

    const getSessionEncryption = vi.fn().mockReturnValue(undefined);
    const awaitQueue = vi.fn(async () => {
      // 同步未能补上该 session
    });

    await handleUpdateSessionUpdate(
      { seq: 9, createdAt: 999 } as any,
      {
        t: "update-session",
        id: "session-1",
        agentState: { version: 2, value: "encrypted-agent-state" },
      } as any,
      {
        encryption: { getSessionEncryption },
        applySessions: mocks.applySessionsMock,
        fetchSessions: mocks.fetchSessionsMock,
        sessionsSync: { invalidate: vi.fn(), awaitQueue },
      } as any,
    );

    expect(awaitQueue).toHaveBeenCalledTimes(1);
    expect(mocks.fetchSessionsMock).toHaveBeenCalledTimes(1);
    expect(mocks.applySessionsMock).not.toHaveBeenCalled();
  });
});

let handleNewMessageUpdate: typeof import("./syncUpdateHandlers").handleNewMessageUpdate;

describe("handleNewMessageUpdate", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    handleNewMessageUpdate = (await import("./syncUpdateHandlers")).handleNewMessageUpdate;
    mocks.storageState.sessions = {};
  });

  it("启动竞态下先等待 sessions 同步再重试 encryption,而非直接丢弃 (#84)", async () => {
    const encryption = { decryptMessageOutcomes: vi.fn() };

    // encryption 第一次缺失,awaitQueue 之后才就绪
    const getSessionEncryption = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValue(encryption);
    const awaitQueue = vi.fn(async () => {});

    // body 不带 message:只验证 race 守卫路径,跳过解密管线
    await handleNewMessageUpdate(
      { seq: 9, createdAt: 999 } as any,
      { t: "new-message", sid: "session-1" } as any,
      {
        encryption: { getSessionEncryption },
        fetchSessions: mocks.fetchSessionsMock,
        sessionsSync: { invalidate: vi.fn(), awaitQueue },
      } as any,
    );

    expect(awaitQueue).toHaveBeenCalledTimes(1);
    expect(getSessionEncryption).toHaveBeenCalledTimes(2);
    expect(encryption.decryptMessageOutcomes).not.toHaveBeenCalled();
    expect(mocks.fetchSessionsMock).not.toHaveBeenCalled();
  });

  it("等待 sessions 同步后 encryption 仍缺失时,优雅回退到 refetch (#84)", async () => {
    const getSessionEncryption = vi.fn().mockReturnValue(undefined);
    const awaitQueue = vi.fn(async () => {});

    await handleNewMessageUpdate(
      { seq: 9, createdAt: 999 } as any,
      { t: "new-message", sid: "session-1" } as any,
      {
        encryption: { getSessionEncryption },
        fetchSessions: mocks.fetchSessionsMock,
        sessionsSync: { invalidate: vi.fn(), awaitQueue },
      } as any,
    );

    expect(awaitQueue).toHaveBeenCalledTimes(1);
    expect(getSessionEncryption).toHaveBeenCalledTimes(2);
    expect(mocks.fetchSessionsMock).toHaveBeenCalledTimes(1);
  });

  it("decrypt-failed 的实时消息触发 refetch 以恢复密钥,且不入队 (#2)", async () => {
    const decryptMessageOutcomes = vi.fn(async () => [
      { ok: false, reason: "decrypt-failed", seq: 42, id: "m1" },
    ]);
    const getSessionEncryption = vi.fn().mockReturnValue({
      decryptMessageOutcomes,
    });
    const enqueueMessages = vi.fn();

    await handleNewMessageUpdate(
      { seq: 42, createdAt: 999 } as any,
      {
        t: "new-message",
        sid: "session-1",
        message: { id: "m1", seq: 42, content: { t: "encrypted", c: "x" } },
      } as any,
      {
        encryption: { getSessionEncryption },
        fetchSessions: mocks.fetchSessionsMock,
        enqueueMessages,
        sessionsSync: { invalidate: vi.fn(), awaitQueue: vi.fn(async () => {}) },
      } as any,
    );

    expect(decryptMessageOutcomes).toHaveBeenCalledTimes(1);
    expect(mocks.fetchSessionsMock).toHaveBeenCalledTimes(1);
    // The message must NOT be marked processed / enqueued — a recovered key
    // needs to re-decrypt it on refetch.
    expect(enqueueMessages).not.toHaveBeenCalled();
  });
});
