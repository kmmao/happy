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
                  happy__search: {},
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
    });

    expect(response).toEqual({ content: [] });
    expect(client.getSessionId()).toBe("thread-1");
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

  it("responds to request_user_input through the elicitation handler", async () => {
    const client = new CodexAppServerClient();
    client.setElicitationHandler(async () => ({
      action: "accept",
      content: { choice: "A" },
    }));

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

  it("resumes an existing thread id", async () => {
    const client = new CodexAppServerClient();

    await client.connect();
    await client.resumeThread({ threadId: "thread-existing" });

    expect(client.getSessionId()).toBe("thread-existing");
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

  it("emits a diff preview service message", async () => {
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
          event.type === "service_message" &&
          typeof event.text === "string" &&
          event.text.includes("Latest diff preview:"),
      ),
    ).toBe(true);
  });
});
