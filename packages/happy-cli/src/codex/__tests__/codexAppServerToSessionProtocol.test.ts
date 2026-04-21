import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { HAPPY_MCP_TOOL_NAMES } from "@kmmao/happy-wire";
import { CodexAppServerClient } from "@/codex-app/CodexAppServerClient";
import {
  mapCodexMcpMessageToSessionEnvelopes,
  mapCodexProcessorMessageToSessionEnvelopes,
  type CodexTurnState,
} from "../utils/sessionProtocolMapper";

type FakeRpcMessage = {
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadCodexAppFixture<T>(name: string): T {
  const fixturePath = join(__dirname, "..", "..", "codex-app", "__fixtures__", name);
  return JSON.parse(readFileSync(fixturePath, "utf8")) as T;
}

async function flushNotifications(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function replayServerNotifications(
  process: FakeProcess,
  notifications: FakeRpcMessage[],
): Promise<void> {
  for (const notification of notifications) {
    process.stdout.write(`${JSON.stringify(notification)}\n`);
  }
  await flushNotifications();
}

class FakeProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;
  responses: FakeRpcMessage[] = [];
  requests: FakeRpcMessage[] = [];

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
            data: [
              {
                id: "model-1",
                model: "gpt-5.4",
                displayName: "GPT-5.4",
                description: "Most capable",
                supportedReasoningEfforts: [{ value: "high", label: "High" }],
                supportsPersonality: true,
                isDefault: true,
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
            data: [],
            nextCursor: null,
          },
        });
        return;
      case "skills/list":
        this.writeServerMessage({
          id: payload.id,
          result: {
            data: [],
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
                tools: Object.fromEntries(
                  HAPPY_MCP_TOOL_NAMES.map((toolName) => [`happy__${toolName}`, {}]),
                ),
                resources: [],
                resourceTemplates: [],
              },
            ],
            nextCursor: null,
          },
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

function relayClientEventsToSessionEnvelopes(events: Array<Record<string, unknown>>) {
  let state: CodexTurnState = {
    currentTurnId: null,
    startedSubagents: new Set<string>(),
    activeSubagents: new Set<string>(),
    providerSubagentToSessionSubagent: new Map<string, string>(),
  };

  const envelopes: any[] = [];

  for (const event of events) {
    if (event.type === "tool-call" || event.type === "tool-call-result") {
      envelopes.push(...mapCodexProcessorMessageToSessionEnvelopes(event as any, state));
      continue;
    }

    if (
      event.type === "agent_reasoning_delta" ||
      event.type === "agent_reasoning" ||
      event.type === "agent_reasoning_section_break" ||
      event.type === "turn_diff" ||
      event.type === "turn_plan_updated"
    ) {
      continue;
    }

    const mapped = mapCodexMcpMessageToSessionEnvelopes(event as any, state);
    state = {
      currentTurnId: mapped.currentTurnId,
      startedSubagents: mapped.startedSubagents,
      activeSubagents: mapped.activeSubagents,
      providerSubagentToSessionSubagent: mapped.providerSubagentToSessionSubagent,
    };
    envelopes.push(...mapped.envelopes);
  }

  return envelopes;
}

function normalizeEnvelopeSequence(envelopes: any[]) {
  let generatedTurn: string | null = null;
  const subagentAliases = new Map<string, string>();

  const normalizeCall = (call: string) =>
    /^codex-diff-\d+$/.test(call) ? "<generated-codex-diff>" : call;

  return envelopes.map((envelope) => {
    if (envelope.turn && !generatedTurn) {
      generatedTurn = envelope.turn;
    }

    let subagent: string | null = envelope.subagent ?? null;
    if (subagent) {
      if (!subagentAliases.has(subagent)) {
        subagentAliases.set(subagent, `<generated-subagent-${subagentAliases.size + 1}>`);
      }
      subagent = subagentAliases.get(subagent)!;
    }

    const turn = envelope.turn
      ? envelope.turn === generatedTurn
        ? "<generated-turn>"
        : envelope.turn
      : null;

    const event =
      envelope.ev.t === "tool-call-start"
        ? {
            t: envelope.ev.t,
            call: normalizeCall(envelope.ev.call),
            name: envelope.ev.name,
            title: envelope.ev.title,
            description: envelope.ev.description,
          }
        : envelope.ev.t === "tool-call-end"
          ? {
              t: envelope.ev.t,
              call: normalizeCall(envelope.ev.call),
            }
          : envelope.ev;

    return { turn, subagent, event };
  });
}

async function collectEventsFromFixture(fixtureName: string) {
  const events: Array<Record<string, unknown>> = [];
  const client = new CodexAppServerClient();
  client.setHandler((event) => events.push(event));

  await client.connect();
  const notifications = loadCodexAppFixture<FakeRpcMessage[]>(fixtureName);
  await replayServerNotifications(fakeProcesses[0], notifications);
  await client.disconnect();

  return events;
}

describe("CodexAppServerClient → sessionProtocolMapper chain", () => {
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

  it("maps core app-server notifications through the client and into session envelopes", async () => {
    const events = await collectEventsFromFixture("notification_contract_core.json");
    const envelopes = relayClientEventsToSessionEnvelopes(events);

    expect(normalizeEnvelopeSequence(envelopes)).toEqual([
      { turn: "<generated-turn>", subagent: null, event: { t: "turn-start" } },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "text-delta",
          stream: "item-msg-1",
          delta: "hello from app-server",
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "text-delta",
          stream: "item-reason-1",
          delta: "thinking chunk",
          thinking: true,
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "text-delta",
          stream: "item-reason-1",
          delta: "summary chunk",
          thinking: true,
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "service",
          text: ["Plan updated", "[completed] Inspect logs", "[inProgress] Patch parser"].join("\n"),
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "tool-call-start",
          call: "<generated-codex-diff>",
          name: "CodexDiff",
          title: "CodexDiff call",
          description: "CodexDiff call",
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "tool-call-end",
          call: "<generated-codex-diff>",
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "service",
          text: "Codex rerouted model from gpt-5.4 to gpt-5.4-mini",
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "service",
          text: "Config warning\nprofile missing optional key",
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "turn-end",
          status: "failed",
        },
      },
    ]);
  });

  it("maps item lifecycle notifications through the client and into session envelopes", async () => {
    const events = await collectEventsFromFixture("notification_contract_items.json");
    const envelopes = relayClientEventsToSessionEnvelopes(events);

    expect(normalizeEnvelopeSequence(envelopes)).toEqual([
      {
        turn: null,
        subagent: null,
        event: {
          t: "tool-call-start",
          call: "cmd-1",
          name: "CodexBash",
          title: "Run `bash -lc ls`",
          description: "bash -lc ls",
        },
      },
      {
        turn: null,
        subagent: null,
        event: {
          t: "tool-call-end",
          call: "cmd-1",
        },
      },
      {
        turn: null,
        subagent: null,
        event: {
          t: "tool-call-start",
          call: "patch-1",
          name: "CodexPatch",
          title: "Apply patch",
          description: "Applying patch to 1 file",
        },
      },
      {
        turn: null,
        subagent: null,
        event: {
          t: "tool-call-end",
          call: "patch-1",
        },
      },
      {
        turn: null,
        subagent: null,
        event: {
          t: "tool-call-start",
          call: "dynamic-1",
          name: "mcp__happy__change_title",
          title: "新标题",
          description: "新标题",
        },
      },
      {
        turn: null,
        subagent: null,
        event: {
          t: "text",
          text: "title updated",
          thinking: true,
        },
      },
      {
        turn: null,
        subagent: null,
        event: {
          t: "tool-call-end",
          call: "dynamic-1",
        },
      },
      {
        turn: null,
        subagent: null,
        event: {
          t: "tool-call-start",
          call: "mcp-1",
          name: "mcp__happy__change_title",
          title: "标题",
          description: "标题",
        },
      },
      {
        turn: null,
        subagent: null,
        event: {
          t: "tool-call-start",
          call: "mcp-1",
          name: "mcp__happy__change_title",
          title: "mcp__happy__change_title",
          description: "waiting for permission review",
        },
      },
      {
        turn: null,
        subagent: null,
        event: {
          t: "text",
          text: "user rejected MCP tool call",
          thinking: true,
        },
      },
      {
        turn: null,
        subagent: null,
        event: {
          t: "tool-call-end",
          call: "mcp-1",
        },
      },
      {
        turn: null,
        subagent: null,
        event: {
          t: "service",
          text: "Review started",
        },
      },
      {
        turn: null,
        subagent: null,
        event: {
          t: "service",
          text: "Review completed",
        },
      },
    ]);
  });

  it("preserves richer upstream-like notifications through the client to mapper chain", async () => {
    const events = await collectEventsFromFixture("notification_contract_upstream_rich.json");
    const envelopes = relayClientEventsToSessionEnvelopes(events);

    expect(normalizeEnvelopeSequence(envelopes)).toEqual([
      { turn: "<generated-turn>", subagent: null, event: { t: "turn-start" } },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "tool-call-start",
          call: "call_dynamic_1",
          name: "change_title",
          title: "新标题",
          description: "新标题",
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "text",
          text: "dynamic-ok\n[image] data:image/png;base64,AAA",
          thinking: true,
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "tool-call-end",
          call: "call_dynamic_1",
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "service",
          text: "current changes",
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "service",
          text: "Looks solid overall...\n\n- Prefer Stylize helpers — app.rs:10-20\n  ...",
        },
      },
      {
        turn: "<generated-turn>",
        subagent: null,
        event: {
          t: "turn-end",
          status: "cancelled",
        },
      },
    ]);
  });
});
