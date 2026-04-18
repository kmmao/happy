import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/api/api";
import type { ApiSessionClient } from "@/api/apiSession";
import type { AgentState, Metadata, Session } from "@/api/types";
import { setupOfflineReconnection } from "./setupOfflineReconnection";

function createMetadata(overrides: Partial<Metadata> = {}): Metadata {
  return {
    path: "/repo",
    host: "test-host",
    version: "0.71.44",
    os: "darwin",
    machineId: "machine-1",
    homeDir: "/Users/test",
    happyHomeDir: "/Users/test/.happy",
    happyLibDir: "/Users/test/.happy/lib",
    happyToolsDir: "/Users/test/.happy/tools",
    ...overrides,
  };
}

function createResponse(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    seq: 1,
    metadata: createMetadata(),
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 0,
    dataEncryptionKey: new Uint8Array([1, 2, 3]),
    createdAt: 1,
    updatedAt: 1,
    active: true,
    activeAt: 1,
    lastMessage: null,
    ...overrides,
  } as Session;
}

describe("setupOfflineReconnection", () => {
  it("merges startup metadata into reconnected sessions without dropping Codex resume state", () => {
    const updateMetadata = vi.fn();
    const sessionClient = {
      updateMetadata,
    } as unknown as ApiSessionClient;
    const api = {
      sessionSyncClient: vi.fn().mockReturnValue(sessionClient),
    } as unknown as ApiClient;

    const startupMetadata = createMetadata({
      version: "0.71.44",
      startedBy: "daemon",
      codex: {
        requestedBackend: "codex-app-server",
        config: {
          profile: "managed-profile",
        },
      },
    });

    const result = setupOfflineReconnection({
      api,
      sessionTag: "tag-1",
      metadata: startupMetadata,
      state: null as unknown as AgentState,
      response: createResponse(),
      onSessionSwap: vi.fn(),
      happySessionId: "session-1",
    });

    expect(result.isOffline).toBe(false);
    expect(updateMetadata).toHaveBeenCalledTimes(1);

    const updater = updateMetadata.mock.calls[0][0] as (
      existing: Metadata,
    ) => Metadata;
    const existingMetadata = createMetadata({
      version: "0.71.43",
      progress: {
        updatedAt: 1,
        todos: [{ content: "Keep progress", status: "pending" }],
      },
      sessionSummary: {
        goal: "Preserve agent summary",
        updatedAt: 1,
      },
      codex: {
        resolvedBackend: "codex-app-server",
        threadId: "thread_123",
        config: {
          model: "gpt-5.4",
          sandboxMode: "workspace-write",
        },
      },
    });

    expect(updater(existingMetadata)).toEqual(
      expect.objectContaining({
        version: "0.71.44",
        startedBy: "daemon",
        progress: existingMetadata.progress,
        sessionSummary: existingMetadata.sessionSummary,
        codex: expect.objectContaining({
          requestedBackend: "codex-app-server",
          resolvedBackend: "codex-app-server",
          threadId: "thread_123",
          config: expect.objectContaining({
            model: "gpt-5.4",
            sandboxMode: "workspace-write",
            profile: "managed-profile",
          }),
        }),
      }),
    );
  });

  it("does not patch metadata for brand new sessions", () => {
    const updateMetadata = vi.fn();
    const sessionClient = {
      updateMetadata,
    } as unknown as ApiSessionClient;
    const api = {
      sessionSyncClient: vi.fn().mockReturnValue(sessionClient),
    } as unknown as ApiClient;

    setupOfflineReconnection({
      api,
      sessionTag: "tag-1",
      metadata: createMetadata(),
      state: null as unknown as AgentState,
      response: createResponse(),
      onSessionSwap: vi.fn(),
    });

    expect(updateMetadata).not.toHaveBeenCalled();
  });
});
