import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexAppServerClient } from "./CodexAppServerClient";

type FakeRpcMessage = {
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
};

class FakeProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;
  responses: FakeRpcMessage[] = [];
  requests: FakeRpcMessage[] = [];
  modelListOverride: unknown = null;

  constructor() {
    super();
    let buffer = "";
    this.stdin.on("data", (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n");
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        const payload = JSON.parse(line) as FakeRpcMessage;
        if (payload.method) {
          this.requests.push(payload);
          this.handleRequest(payload);
        } else {
          this.responses.push(payload);
        }
      }
    });
  }

  private writeServerMessage(payload: FakeRpcMessage): void {
    this.stdout.write(`${JSON.stringify(payload)}\n`);
  }

  private handleRequest(payload: FakeRpcMessage): void {
    switch (payload.method) {
      case "initialize":
        this.writeServerMessage({
          id: payload.id,
          result: {
            userAgent: "codex-app-server-test",
            codexHome: "/tmp/.codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
        });
        return;
      case "model/list":
        this.writeServerMessage({
          id: payload.id,
          result: {
            data: (this.modelListOverride as unknown[]) ?? [
              {
                id: "model-1",
                model: "gpt-5.4",
                displayName: "GPT-5.4",
                description: "Most capable",
                supportedReasoningEfforts: [{ value: "high", label: "High" }],
                defaultReasoningEffort: "high",
                inputModalities: ["text"],
                supportsPersonality: true,
                additionalSpeedTiers: [],
                isDefault: true,
                hidden: false,
                upgrade: null,
                upgradeInfo: null,
                availabilityNux: null,
              },
            ],
            nextCursor: null,
          },
        });
        return;
      case "config/read":
        this.writeServerMessage({
          id: payload.id,
          result: {
            config: {
              model: "gpt-5.4",
              profile: "default",
              approval_policy: "on-request",
              sandbox_mode: "workspace-write",
              service_tier: "default",
              model_reasoning_effort: "high",
              model_reasoning_summary: "concise",
              model_verbosity: "medium",
              web_search: "live",
            },
          },
        });
        return;
      case "account/read":
        this.writeServerMessage({
          id: payload.id,
          result: {
            account: {
              type: "chatgpt",
              email: "dev@example.com",
              planType: "plus",
            },
            requiresOpenaiAuth: false,
          },
        });
        return;
      case "account/login/start":
        this.writeServerMessage({
          id: payload.id,
          result: {
            type: payload.params?.type ?? "apiKey",
          },
        });
        return;
      case "account/rateLimits/read":
        this.writeServerMessage({
          id: payload.id,
          result: {
            rateLimits: {
              limitId: "codex",
              limitName: "Codex",
              planType: "plus",
              credits: {
                total: 10,
                remaining: 8,
              },
            },
          },
        });
        return;
      case "experimentalFeature/list":
        this.writeServerMessage({
          id: payload.id,
          result: {
            data: [
              {
                name: "app_server_review",
                stage: "beta",
                enabled: true,
                defaultEnabled: false,
              },
            ],
            nextCursor: null,
          },
        });
        return;
      case "skills/list":
        this.writeServerMessage({
          id: payload.id,
          result: {
            data: [
              {
                cwd: process.cwd(),
                skills: [
                  {
                    name: "repo-notes",
                    description: "Repo-specific notes",
                    path: "/tmp/repo-notes/SKILL.md",
                    enabled: true,
                  },
                ],
                errors: [],
              },
            ],
          },
        });
        return;
      case "mcpServerStatus/list":
        this.writeServerMessage({
          id: payload.id,
          result: {
            data: [
              {
                name: "happy",
                authStatus: "unsupported",
                tools: {
                  happy__change_title: {},
                  happy__query_project_knowledge: {},
                },
                resources: [],
                resourceTemplates: [],
              },
            ],
            nextCursor: null,
          },
        });
        return;
      case "thread/start":
        this.writeServerMessage({
          id: payload.id,
          result: {
            thread: {
              id: "thread-1",
              forkedFromId: null,
              preview: "hello",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 0,
              updatedAt: 0,
              status: "idle",
              path: null,
              cwd: process.cwd(),
              cliVersion: "0.120.0",
              source: "codex-app-server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: null,
              turns: [],
            },
            model: "gpt-5.4",
            modelProvider: "openai",
            serviceTier: null,
            cwd: process.cwd(),
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: { type: "dangerFullAccess" },
            reasoningEffort: "high",
          },
        });
        return;
      case "thread/resume":
        this.writeServerMessage({
          id: payload.id,
          result: {
            thread: {
              id: payload.params?.threadId ?? "thread-1",
              forkedFromId: null,
              preview: "hello",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 0,
              updatedAt: 0,
              status: "idle",
              path: null,
              cwd: process.cwd(),
              cliVersion: "0.120.0",
              source: "codex-app-server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: null,
              turns: [],
            },
            model: "gpt-5.4",
            modelProvider: "openai",
            serviceTier: null,
            cwd: process.cwd(),
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: { type: "dangerFullAccess" },
            reasoningEffort: "high",
          },
        });
        return;
      case "turn/start": {
        const turnId = `turn-${this.requests.filter((request) => request.method === "turn/start").length}`;
        this.writeServerMessage({
          id: payload.id,
          result: {
            turn: {
              id: turnId,
              items: [],
              status: "inProgress",
              error: null,
              startedAt: 0,
              completedAt: null,
              durationMs: null,
            },
          },
        });
        const promptText =
          payload.params?.input?.[0]?.text ?? payload.params?.input?.[0]?.content ?? "";
        if (String(promptText).includes("slow")) {
          return;
        }
        setTimeout(() => {
          this.writeServerMessage({
            method: "turn/started",
            params: {
              threadId: "thread-1",
              turn: {
                id: turnId,
              },
            },
          });
          this.writeServerMessage({
            method: "item/agentMessage/delta",
            params: {
              threadId: "thread-1",
              turnId,
              itemId: "item-1",
              delta: "hello from codex",
            },
          });
          this.writeServerMessage({
            method: "turn/completed",
            params: {
              threadId: "thread-1",
              turn: {
                id: turnId,
                items: [],
                status: "completed",
                error: null,
                startedAt: 0,
                completedAt: 1,
                durationMs: 1,
              },
            },
          });
        }, 0);
        return;
      }
      case "turn/interrupt":
      case "turn/steer":
        this.writeServerMessage({
          id: payload.id,
          result: {},
        });
        return;
      default:
        this.writeServerMessage({
          id: payload.id,
          result: {},
        });
    }
  }

  kill(): boolean {
    this.killed = true;
    this.emit("exit", 0, null);
    return true;
  }
}

const { mockSpawn, fakeProcesses } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  fakeProcesses: [] as FakeProcess[],
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    spawn: mockSpawn,
  };
});

vi.mock("@/ui/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("CodexAppServerClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeProcesses.splice(0);
    mockSpawn.mockImplementation(() => {
      const process = new FakeProcess();
      fakeProcesses.push(process);
      return process as any;
    });
  });

  afterEach(() => {
    for (const process of fakeProcesses) {
      if (!process.killed) {
        process.kill();
      }
    }
  });

  it("connects, loads capabilities, and completes a started turn", async () => {
    const events: any[] = [];
    const client = new CodexAppServerClient();
    client.setHandler((event) => events.push(event));

    await client.connect();
    expect(client.getCapabilities()?.models[0]?.model).toBe("gpt-5.4");
    expect(client.getCapabilities()?.config).toEqual({
      model: "gpt-5.4",
      profile: "default",
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
      serviceTier: "default",
      reasoningEffort: "high",
      reasoningSummary: "concise",
      verbosity: "medium",
      webSearch: "live",
    });
    expect(client.getCapabilities()?.account).toEqual({
      type: "chatgpt",
      email: "dev@example.com",
      planType: "plus",
      requiresOpenaiAuth: false,
    });
    expect(client.getCapabilities()?.rateLimits).toEqual({
      limitId: "codex",
      limitName: "Codex",
      planType: "plus",
      hasCredits: true,
    });
    expect(client.getCapabilities()?.experimentalFeatures).toEqual([
      {
        name: "app_server_review",
        stage: "beta",
        enabled: true,
        defaultEnabled: false,
      },
    ]);
    expect(client.getCapabilities()?.skills).toEqual([
      {
        name: "repo-notes",
        description: "Repo-specific notes",
        path: "/tmp/repo-notes/SKILL.md",
        enabled: true,
      },
    ]);
    expect(client.getCapabilities()?.mcpServers).toEqual([
      {
        name: "happy",
        authStatus: "unsupported",
        toolCount: 2,
      },
    ]);

    const response = await client.startSession({
      prompt: "hello",
      model: "gpt-5.4",
      "base-instructions": "Use request_user_input for questions",
    });

    expect(response).toEqual({ content: [] });
    expect(client.getSessionId()).toBe("thread-1");
    expect(
      fakeProcesses[0].requests.find((request) => request.method === "thread/start")?.params,
    ).toMatchObject({
      baseInstructions: "Use request_user_input for questions",
    });
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "task_started" },
        { type: "text_delta", stream: "item-1", delta: "hello from codex" },
        { type: "task_complete", status: "completed" },
      ]),
    );

    await client.disconnect();
    expect(fakeProcesses[0].killed).toBe(true);
  });

  it("normalizes reasoning effort shapes returned by newer app-server builds", async () => {
    const fakeProcess = new FakeProcess();
    fakeProcess.modelListOverride = [
      {
        id: "model-1",
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        description: "Most capable",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Fast" },
          { reasoningEffort: "high", description: "Deep" },
        ],
        supportsPersonality: true,
        isDefault: true,
      },
    ];
    mockSpawn.mockImplementation(() => {
      fakeProcesses.push(fakeProcess);
      return fakeProcess as any;
    });

    const client = new CodexAppServerClient();

    await client.connect();

    expect(client.getCapabilities()?.models[0]?.supportedReasoningEfforts).toEqual([
      { value: "low", label: "Fast" },
      { value: "high", label: "Deep" },
    ]);

    await client.disconnect();
  });

  it("responds to command approval requests through the permission handler", async () => {
    const client = new CodexAppServerClient();
    client.setPermissionHandler({
      handleToolCall: vi.fn(async () => ({ decision: "approved_for_session" })),
    } as any);

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "approval-1",
        method: "item/commandExecution/requestApproval",
        params: {
          command: "rm -rf build",
          cwd: "/tmp/project",
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(fakeProcesses[0].responses).toContainEqual({
      id: "approval-1",
      result: { decision: "acceptForSession" },
    });
  });

  it("responds to legacy execCommandApproval requests through the permission handler", async () => {
    const client = new CodexAppServerClient();
    const handleToolCall = vi.fn(async () => ({
      decision: "approved_for_session" as const,
    }));
    client.setPermissionHandler({ handleToolCall } as any);

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "legacy-exec-1",
        method: "execCommandApproval",
        params: {
          conversationId: "thread-1",
          callId: "call-legacy-exec",
          approvalId: "approval-legacy-exec",
          command: ["rm", "-rf", "build"],
          cwd: "/tmp/project",
          reason: "Needs dangerous command approval",
          parsedCmd: [],
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(handleToolCall).toHaveBeenCalledWith("call-legacy-exec", "CodexBash", {
      command: ["rm", "-rf", "build"],
      cwd: "/tmp/project",
      reason: "Needs dangerous command approval",
      parsedCmd: [],
      approvalId: "approval-legacy-exec",
    });
    expect(fakeProcesses[0].responses).toContainEqual({
      id: "legacy-exec-1",
      result: { decision: "approved_for_session" },
    });
  });

  it("responds to legacy applyPatchApproval requests through the permission handler", async () => {
    const client = new CodexAppServerClient();
    const handleToolCall = vi.fn(async () => ({
      decision: "approved" as const,
    }));
    client.setPermissionHandler({ handleToolCall } as any);

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "legacy-patch-1",
        method: "applyPatchApproval",
        params: {
          conversationId: "thread-1",
          callId: "call-legacy-patch",
          fileChanges: {
            "/tmp/file.ts": {
              changeType: "modify",
            },
          },
          reason: "Needs broader write access",
          grantRoot: "/tmp",
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(handleToolCall).toHaveBeenCalledWith("call-legacy-patch", "CodexPatch", {
      reason: "Needs broader write access",
      grantRoot: "/tmp",
      fileChanges: {
        "/tmp/file.ts": {
          changeType: "modify",
        },
      },
    });
    expect(fakeProcesses[0].responses).toContainEqual({
      id: "legacy-patch-1",
      result: { decision: "approved" },
    });
  });

  it("responds to generic permission approval requests through the permission handler", async () => {
    const client = new CodexAppServerClient();
    const handleToolCall = vi.fn(async () => ({
      decision: "approved_for_session" as const,
    }));
    client.setPermissionHandler({
      handleToolCall,
    } as any);

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "perm-1",
        method: "item/permissions/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "mcp-1",
          reason: "Allow Happy MCP title updates",
          permissions: {
            network: { enabled: true },
            fileSystem: {
              read: ["/tmp/readable"],
              write: ["/tmp/writable"],
            },
          },
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(handleToolCall).toHaveBeenCalledWith("mcp-1", "CodexPermissions", {
      itemId: "mcp-1",
      reason: "Allow Happy MCP title updates",
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: ["/tmp/readable"],
          write: ["/tmp/writable"],
        },
      },
    });
    expect(fakeProcesses[0].responses).toContainEqual({
      id: "perm-1",
      result: {
        permissions: {
          network: { enabled: true },
          fileSystem: {
            read: ["/tmp/readable"],
            write: ["/tmp/writable"],
          },
        },
        scope: "session",
      },
    });
  });

  it("passes through the real Happy MCP tool name for title permission approvals", async () => {
    const client = new CodexAppServerClient();
    const handleToolCall = vi.fn(async () => ({
      decision: "approved" as const,
    }));
    client.setPermissionHandler({
      handleToolCall,
    } as any);

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "item/started",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "mcpToolCall",
            id: "mcp-title-1",
            server: "happy",
            tool: "change_title",
            arguments: { title: "标题" },
            status: "inProgress",
            result: null,
            error: null,
            durationMs: null,
          },
        },
      })}\n`,
    );
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "perm-title-1",
        method: "item/permissions/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "mcp-title-1",
          reason: "Allow Happy MCP title updates",
          permissions: {
            network: { enabled: true },
          },
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(handleToolCall).toHaveBeenCalledWith(
      "mcp-title-1",
      "mcp__happy__change_title",
      {
        itemId: "mcp-title-1",
        reason: "Allow Happy MCP title updates",
        permissions: {
          network: { enabled: true },
        },
        requestedToolName: "mcp__happy__change_title",
      },
    );
    expect(fakeProcesses[0].responses).toContainEqual({
      id: "perm-title-1",
      result: {
        permissions: {
          network: { enabled: true },
        },
        scope: "turn",
      },
    });
  });

  it("returns an empty permission grant when generic permission approval is denied", async () => {
    const client = new CodexAppServerClient();
    client.setPermissionHandler({
      handleToolCall: vi.fn(async () => ({ decision: "denied" })),
    } as any);

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "perm-2",
        method: "item/permissions/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "perm-item-2",
          reason: "Deny extra filesystem access",
          permissions: {
            fileSystem: {
              read: ["/tmp/nope"],
              write: ["/tmp/nope-write"],
            },
          },
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(fakeProcesses[0].responses).toContainEqual({
      id: "perm-2",
      result: {
        permissions: {},
        scope: "turn",
      },
    });
  });

  it("responds to request_user_input through the elicitation handler", async () => {
    const client = new CodexAppServerClient();
    const elicitationHandler = vi.fn(async () => ({
      action: "accept" as const,
      content: { choice: "A" },
    }));
    client.setElicitationHandler(elicitationHandler);

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "question-1",
        method: "item/tool/requestUserInput",
        params: {
          questions: [
            {
              id: "choice",
              header: "Pick one",
              question: "Choose an option",
              isOther: false,
              isSecret: false,
              options: [{ label: "A", description: "Option A" }],
            },
          ],
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(elicitationHandler).toHaveBeenCalledWith(
      {
        serverName: "Codex",
        message: "Choose an option",
        mode: "form",
        requestedSchema: {
          type: "object",
          required: ["choice"],
          properties: {
            choice: {
              type: "string",
              title: "Pick one",
              description: "Choose an option",
              oneOf: [{ const: "A", title: "A", description: "Option A" }],
              "x-happy-other": false,
              "x-happy-secret": false,
            },
          },
        },
      },
      expect.any(Object),
    );
    expect(fakeProcesses[0].responses).toContainEqual({
      id: "question-1",
      result: {
        answers: {
          choice: {
            answers: ["A"],
          },
        },
      },
    });
  });

  it("responds to MCP form elicitation through the shared elicitation handler", async () => {
    const client = new CodexAppServerClient();
    const elicitationHandler = vi.fn(async () => ({
      action: "accept" as const,
      content: { token: "abc123" },
    }));
    client.setElicitationHandler(elicitationHandler);

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "mcp-elicit-1",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          serverName: "happy",
          mode: "form",
          message: "Provide API token",
          requestedSchema: {
            type: "object",
            properties: {
              token: {
                type: "string",
                description: "API token",
              },
            },
          },
          _meta: { connector: "happy" },
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(elicitationHandler).toHaveBeenCalledWith(
      {
        serverName: "happy",
        message: "Provide API token",
        mode: "form",
        requestedSchema: {
          type: "object",
          properties: {
            token: {
              type: "string",
              description: "API token",
            },
          },
        },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fakeProcesses[0].responses).toContainEqual({
      id: "mcp-elicit-1",
      result: {
        action: "accept",
        content: { token: "abc123" },
        _meta: null,
      },
    });
  });

  it("auto-approves Happy MCP tool approval elicitation through the permission handler", async () => {
    const client = new CodexAppServerClient();
    const handleToolCall = vi.fn(async () => ({
      decision: "approved" as const,
    }));
    const elicitationHandler = vi.fn(async () => ({
      action: "decline" as const,
    }));
    client.setPermissionHandler({ handleToolCall } as any);
    client.setElicitationHandler(elicitationHandler);

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "mcp-elicit-approve-1",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          serverName: "happy",
          mode: "form",
          message: 'Allow the happy MCP server to run tool "change_title"?',
          requestedSchema: {
            type: "object",
            properties: {},
          },
          _meta: {
            codex_approval_kind: "mcp_tool_call",
            tool_title: "Change Chat Title",
          },
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(handleToolCall).toHaveBeenCalledWith(
      "mcp-elicit-approve-1",
      "mcp__happy__change_title",
      expect.objectContaining({
        requestedToolName: "mcp__happy__change_title",
      }),
    );
    expect(elicitationHandler).not.toHaveBeenCalled();
    expect(fakeProcesses[0].responses).toContainEqual({
      id: "mcp-elicit-approve-1",
      result: {
        action: "accept",
        content: {},
        _meta: null,
      },
    });
  });

  it("responds to MCP URL elicitation through the shared elicitation handler", async () => {
    const client = new CodexAppServerClient();
    const elicitationHandler = vi.fn(async () => ({
      action: "decline" as const,
    }));
    client.setElicitationHandler(elicitationHandler);

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "mcp-elicit-2",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thread-1",
          turnId: null,
          serverName: "github",
          mode: "url",
          message: "Open browser to finish GitHub login",
          url: "https://github.com/login/oauth/authorize",
          elicitationId: "oauth-1",
          _meta: null,
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(elicitationHandler).toHaveBeenCalledWith(
      {
        serverName: "github",
        message: "Open browser to finish GitHub login",
        mode: "url",
        url: "https://github.com/login/oauth/authorize",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fakeProcesses[0].responses).toContainEqual({
      id: "mcp-elicit-2",
      result: {
        action: "decline",
        content: null,
        _meta: null,
      },
    });
  });

  it("renders plan updates from step text when title is missing", async () => {
    const events: any[] = [];
    const client = new CodexAppServerClient();
    client.setHandler((event) => events.push(event));

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "turn/plan/updated",
        params: {
          explanation: "Plan updated",
          plan: [
            { step: "Inspect logs", status: "completed" },
            { step: "Patch parser", status: "in_progress" },
            { step: "Verify UI", status: "pending" },
          ],
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(events).toContainEqual({
      type: "service_message",
      text: [
        "Plan updated",
        "[completed] Inspect logs",
        "[in_progress] Patch parser",
        "[pending] Verify UI",
      ].join("\n"),
    });
  });

  it("responds to dynamic tool calls through the dynamic tool handler", async () => {
    const client = new CodexAppServerClient();
    const dynamicToolHandler = vi.fn(async () => ({
      contentItems: [{ type: "inputText" as const, text: 'Successfully changed chat title to: "MCP调用排查"' }],
      success: true,
    }));
    client.setDynamicToolHandler(dynamicToolHandler);

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "tool-1",
        method: "item/tool/call",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "call-1",
          tool: "mcp__happy__change_title",
          arguments: { title: "MCP调用排查" },
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(dynamicToolHandler).toHaveBeenCalledWith({
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      tool: "mcp__happy__change_title",
      arguments: { title: "MCP调用排查" },
    });
    expect(fakeProcesses[0].responses).toContainEqual({
      id: "tool-1",
      result: {
        contentItems: [{ type: "inputText", text: 'Successfully changed chat title to: "MCP调用排查"' }],
        success: true,
      },
    });
  });

  it("emits visible failure events for completed dynamic tool calls", async () => {
    const events: any[] = [];
    const client = new CodexAppServerClient();
    client.setHandler((event) => events.push(event));

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "item/started",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "dynamicToolCall",
            id: "dynamic-1",
            tool: "mcp__happy__save_memory",
            arguments: { key: "knowledge" },
            status: "inProgress",
            contentItems: null,
            success: null,
            durationMs: null,
          },
        },
      })}\n`,
    );
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "dynamicToolCall",
            id: "dynamic-1",
            tool: "mcp__happy__save_memory",
            arguments: { key: "knowledge" },
            status: "failed",
            contentItems: [
              {
                type: "inputText",
                text: "save_memory failed: storage unavailable",
              },
            ],
            success: false,
            durationMs: 12,
          },
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(events).toContainEqual({
      type: "tool-call",
      callId: "dynamic-1",
      toolName: "mcp__happy__save_memory",
      args: {
        key: "knowledge",
        requestedToolName: "mcp__happy__save_memory",
        toolName: "mcp__happy__save_memory",
      },
    });
    expect(events).toContainEqual({
      type: "tool-call-result",
      callId: "dynamic-1",
      name: "mcp__happy__save_memory",
      output: {
        content: "save_memory failed: storage unavailable",
        status: "canceled",
      },
    });
    expect(
      events.some(
        (event) =>
          event.type === "service_message" &&
          event.text === "save_memory failed: storage unavailable",
      ),
    ).toBe(false);
  });

  it("reuses dynamic tool metadata when item events omit tool details", async () => {
    const events: any[] = [];
    const client = new CodexAppServerClient();
    const dynamicToolHandler = vi.fn(async () => ({
      contentItems: [{ type: "inputText" as const, text: "title updated" }],
      success: true,
    }));
    client.setHandler((event) => events.push(event));
    client.setDynamicToolHandler(dynamicToolHandler);

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "tool-2",
        method: "item/tool/call",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "dynamic-2",
          tool: "mcp__happy__change_title",
          arguments: { title: "新标题" },
        },
      })}\n`,
    );

    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "item/started",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "dynamicToolCall",
            id: "dynamic-2",
            status: "inProgress",
          },
        },
      })}\n`,
    );

    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "dynamicToolCall",
            id: "dynamic-2",
            status: "completed",
            success: true,
            contentItems: [{ type: "inputText", text: "title updated" }],
          },
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(events).toContainEqual({
      type: "tool-call",
      callId: "dynamic-2",
      toolName: "mcp__happy__change_title",
      args: {
        title: "新标题",
        requestedToolName: "mcp__happy__change_title",
        toolName: "mcp__happy__change_title",
      },
    });
    expect(events).toContainEqual({
      type: "tool-call-result",
      callId: "dynamic-2",
      name: "mcp__happy__change_title",
      output: {
        content: "title updated",
        status: "completed",
      },
    });
  });

  it("emits visible failure events for completed mcp tool calls", async () => {
    const events: any[] = [];
    const client = new CodexAppServerClient();
    client.setHandler((event) => events.push(event));

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "item/started",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "mcpToolCall",
            id: "mcp-1",
            server: "happy",
            tool: "change_title",
            arguments: { title: "标题" },
            status: "inProgress",
            result: null,
            error: null,
            durationMs: null,
          },
        },
      })}\n`,
    );
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "mcpToolCall",
            id: "mcp-1",
            server: "happy",
            tool: "change_title",
            arguments: { title: "标题" },
            status: "failed",
            result: null,
            error: { message: "user rejected MCP tool call" },
            durationMs: 8,
          },
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(events).toContainEqual({
      type: "tool-call",
      callId: "mcp-1",
      toolName: "mcp__happy__change_title",
      args: { title: "标题" },
    });
    expect(events).toContainEqual({
      type: "tool-call-result",
      callId: "mcp-1",
      name: "mcp__happy__change_title",
      output: {
        content: "user rejected MCP tool call",
        status: "canceled",
      },
    });
    expect(
      events.some(
        (event) =>
          event.type === "service_message" &&
          event.text === "user rejected MCP tool call",
      ),
    ).toBe(false);
  });

  it("emits readable progress updates for running mcp tool calls", async () => {
    const events: any[] = [];
    const client = new CodexAppServerClient();
    client.setHandler((event) => events.push(event));

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "item/started",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "mcpToolCall",
            id: "mcp-progress-1",
            server: "happy",
            tool: "change_title",
            arguments: { title: "标题" },
            status: "inProgress",
            result: null,
            error: null,
            durationMs: null,
          },
        },
      })}\n`,
    );
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "item/mcpToolCall/progress",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "mcp-progress-1",
          message: "waiting for permission review",
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(events).toContainEqual({
      type: "tool-call",
      callId: "mcp-progress-1",
      toolName: "mcp__happy__change_title",
      args: {
        title: "mcp__happy__change_title",
        description: "waiting for permission review",
      },
    });
  });

  it("resumes an existing thread id", async () => {
    const client = new CodexAppServerClient();

    await client.connect();
    await client.resumeThread({
      threadId: "thread-existing",
      baseInstructions: "Use request_user_input for questions",
    });

    expect(client.getSessionId()).toBe("thread-existing");
    expect(
      fakeProcesses[0].requests.find((request) => request.method === "thread/resume")?.params,
    ).toMatchObject({
      baseInstructions: "Use request_user_input for questions",
    });
  });

  it("interrupts an active turn when aborted", async () => {
    const client = new CodexAppServerClient();
    const controller = new AbortController();

    await client.connect();
    const startPromise = client.startSession(
      {
        prompt: "slow task",
        model: "gpt-5.4",
      },
      { signal: controller.signal },
    );

    setTimeout(() => controller.abort(), 0);

    await expect(startPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(
      fakeProcesses[0].requests.some(
        (request) => request.method === "turn/interrupt",
      ),
    ).toBe(true);
  });

  it("logs in with chatgpt auth tokens", async () => {
    const client = new CodexAppServerClient();
    await client.connect();

    await client.loginWithChatGptAuthTokens({
      accessToken: "access-token",
      chatgptAccountId: "account-1",
      chatgptPlanType: "plus",
    });

    expect(
      fakeProcesses[0].requests.some(
        (request) =>
          request.method === "account/login/start" &&
          request.params?.type === "chatgptAuthTokens" &&
          request.params?.chatgptAccountId === "account-1",
      ),
    ).toBe(true);
  });

  it("responds to chatgpt auth token refresh requests", async () => {
    const client = new CodexAppServerClient();
    client.setChatGptAuthTokensProvider(async () => ({
      accessToken: "fresh-token",
      chatgptAccountId: "account-refresh",
      chatgptPlanType: "plus",
    }));

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        id: "refresh-1",
        method: "account/chatgptAuthTokens/refresh",
        params: {
          reason: "unauthorized",
          previousAccountId: "account-refresh",
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(fakeProcesses[0].responses).toContainEqual({
      id: "refresh-1",
      result: {
        accessToken: "fresh-token",
        chatgptAccountId: "account-refresh",
        chatgptPlanType: "plus",
      },
    });
  });

  it("refreshes capabilities when account state changes", async () => {
    const events: any[] = [];
    const client = new CodexAppServerClient();
    client.setHandler((event) => events.push(event));

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "account/updated",
        params: {
          authMode: "chatgpt",
          planType: "plus",
        },
      })}\n`,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      events.some(
        (event) =>
          event.type === "metadata_refresh" &&
          event.capabilities?.account?.type === "chatgpt",
      ),
    ).toBe(true);
  });

  it("forwards thread token usage updates", async () => {
    const events: any[] = [];
    const client = new CodexAppServerClient();
    client.setHandler((event) => events.push(event));

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-1",
          turnId: "turn-usage-1",
          tokenUsage: {
            total: {
              totalTokens: 1000,
              inputTokens: 700,
              cachedInputTokens: 200,
              outputTokens: 80,
              reasoningOutputTokens: 20,
            },
            last: {
              totalTokens: 220,
              inputTokens: 150,
              cachedInputTokens: 40,
              outputTokens: 20,
              reasoningOutputTokens: 10,
            },
            modelContextWindow: 950000,
          },
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(events).toContainEqual({
      type: "token_count",
      threadId: "thread-1",
      turnId: "turn-usage-1",
      tokenUsage: {
        total: {
          totalTokens: 1000,
          inputTokens: 700,
          cachedInputTokens: 200,
          outputTokens: 80,
          reasoningOutputTokens: 20,
        },
        last: {
          totalTokens: 220,
          inputTokens: 150,
          cachedInputTokens: 40,
          outputTokens: 20,
          reasoningOutputTokens: 10,
        },
        modelContextWindow: 950000,
      },
    });
  });

  it("emits a diff preview as a CodexDiff tool call", async () => {
    const events: any[] = [];
    const client = new CodexAppServerClient();
    client.setHandler((event) => events.push(event));

    await client.connect();
    fakeProcesses[0].stdout.write(
      `${JSON.stringify({
        method: "turn/diff/updated",
        params: {
          diff: "--- a/file.ts\n+++ b/file.ts\n@@\n-old\n+new",
        },
      })}\n`,
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(
      events.some(
        (event) =>
          event.type === "tool-call" &&
          event.toolName === "CodexDiff" &&
          event.args?.unified_diff === "--- a/file.ts\n+++ b/file.ts\n@@\n-old\n+new",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "tool-call-result" &&
          event.name === "CodexDiff" &&
          event.output?.status === "completed",
      ),
    ).toBe(true);
  });
});
