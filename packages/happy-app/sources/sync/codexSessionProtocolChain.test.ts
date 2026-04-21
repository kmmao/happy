import { execSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeRawMessage, type NormalizedMessage } from "./typesRaw";
import { createReducer, reducer } from "./reducer/reducer";

type FakeRpcMessage = {
    id?: string | number;
    method?: string;
    params?: any;
    result?: any;
    error?: any;
};

const repoRoot = resolve(__dirname, "../../../..");
const codexAppFixtureDir = resolve(
    repoRoot,
    "packages/happy-cli/src/codex-app/__fixtures__",
);
const happyCliDistDir = resolve(repoRoot, "packages/happy-cli/dist");
const exposedRunCodexModulePath = resolve(
    happyCliDistDir,
    "runCodex-exposed-for-tests.mjs",
);

function loadCodexAppFixture<T>(name: string): T {
    return JSON.parse(
        readFileSync(resolve(codexAppFixtureDir, name), "utf8"),
    ) as T;
}

async function flushNotifications(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

class FakeProcess extends EventEmitter {
    stdout = new PassThrough();
    stderr = new PassThrough();
    stdin = new PassThrough();
    killed = false;
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
                                supportedReasoningEfforts: [
                                    { value: "high", label: "High" },
                                ],
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
                        data: [],
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

const fakeProcesses: FakeProcess[] = [];
const mockSpawn = vi.fn();

type CodexModules = {
    CodexAppServerClient: any;
    mapCodexMcpMessageToSessionEnvelopes: any;
    mapCodexProcessorMessageToSessionEnvelopes: any;
};

let codexModulesPromise: Promise<CodexModules> | null = null;

async function loadCodexModules(): Promise<CodexModules> {
    if (!codexModulesPromise) {
        execSync("yarn workspace @kmmao/happy-coder build", {
            cwd: repoRoot,
            stdio: "pipe",
        });

        const runCodexBundle = readdirSync(happyCliDistDir).find(
            (entry) => entry.startsWith("runCodex-") && entry.endsWith(".mjs"),
        );
        if (!runCodexBundle) {
            throw new Error("Could not locate built happy-cli runCodex bundle.");
        }

        const runCodexBundlePath = resolve(happyCliDistDir, runCodexBundle);
        const runCodexBundleSource = readFileSync(runCodexBundlePath, "utf8");
        writeFileSync(
            exposedRunCodexModulePath,
            `${runCodexBundleSource}\nexport { CodexAppServerClient, mapCodexMcpMessageToSessionEnvelopes, mapCodexProcessorMessageToSessionEnvelopes };`,
            "utf8",
        );

        vi.doMock("node:child_process", async () => {
            const actual = await vi.importActual<typeof import("node:child_process")>(
                "node:child_process",
            );
            return {
                ...actual,
                spawn: mockSpawn,
            };
        });

        codexModulesPromise = import(
            pathToFileURL(exposedRunCodexModulePath).href
        ).then((module) => ({
            CodexAppServerClient: module.CodexAppServerClient,
            mapCodexMcpMessageToSessionEnvelopes:
                module.mapCodexMcpMessageToSessionEnvelopes,
            mapCodexProcessorMessageToSessionEnvelopes:
                module.mapCodexProcessorMessageToSessionEnvelopes,
        }));
    }

    return codexModulesPromise;
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

function relayClientEventsToEnvelopes(
    events: Array<Record<string, unknown>>,
    mapper: Pick<
        CodexModules,
        "mapCodexMcpMessageToSessionEnvelopes" | "mapCodexProcessorMessageToSessionEnvelopes"
    >,
) {
    let state = {
        currentTurnId: null as string | null,
        startedSubagents: new Set<string>(),
        activeSubagents: new Set<string>(),
        providerSubagentToSessionSubagent: new Map<string, string>(),
    };

    const envelopes: any[] = [];

    for (const event of events) {
        if (event.type === "tool-call" || event.type === "tool-call-result") {
            envelopes.push(
                ...mapper.mapCodexProcessorMessageToSessionEnvelopes(event, state),
            );
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

        const mapped = mapper.mapCodexMcpMessageToSessionEnvelopes(event, state);
        state = {
            currentTurnId: mapped.currentTurnId,
            startedSubagents: mapped.startedSubagents,
            activeSubagents: mapped.activeSubagents,
            providerSubagentToSessionSubagent:
                mapped.providerSubagentToSessionSubagent,
        };
        envelopes.push(...mapped.envelopes);
    }

    return envelopes;
}

function envelopesToNormalized(envelopes: any[]): NormalizedMessage[] {
    return envelopes
        .map((envelope, index) =>
            normalizeRawMessage(
                `raw-${index}`,
                null,
                envelope.time,
                {
                    role: "session",
                    content: {
                        type: "session",
                        data: envelope,
                    },
                } as any,
            ),
        )
        .filter((message): message is NormalizedMessage => message !== null);
}

async function reduceFixture(
    fixtureName: string,
): Promise<ReturnType<typeof reducer>> {
    const modules = await loadCodexModules();
    const events: Array<Record<string, unknown>> = [];
    const client = new modules.CodexAppServerClient();
    client.setHandler((event: Record<string, unknown>) => events.push(event));

    await client.connect();
    const notifications = loadCodexAppFixture<FakeRpcMessage[]>(fixtureName);
    await replayServerNotifications(fakeProcesses[0], notifications);
    await client.disconnect();

    const envelopes = relayClientEventsToEnvelopes(events, modules);
    const normalized = envelopesToNormalized(envelopes);
    const state = createReducer();
    return reducer(state, normalized);
}

async function reduceNotifications(
    notifications: FakeRpcMessage[],
): Promise<ReturnType<typeof reducer>> {
    const modules = await loadCodexModules();
    const events: Array<Record<string, unknown>> = [];
    const client = new modules.CodexAppServerClient();
    client.setHandler((event: Record<string, unknown>) => events.push(event));

    await client.connect();
    await replayServerNotifications(fakeProcesses[0], notifications);
    await client.disconnect();

    const envelopes = relayClientEventsToEnvelopes(events, modules);
    const normalized = envelopesToNormalized(envelopes);
    const state = createReducer();
    return reducer(state, normalized);
}

describe("Codex raw notification → client → mapper → happy-app chain", () => {
    beforeAll(async () => {
        await loadCodexModules();
    });

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

    afterAll(() => {
        try {
            unlinkSync(exposedRunCodexModulePath);
        } catch {
            // Ignore cleanup failures for temporary test helper output.
        }
    });

    it("reduces core app-server notifications into visible messages plus ready state", async () => {
        const result = await reduceFixture("notification_contract_core.json");

        expect(result.hasReadyEvent).toBe(true);
        expect(
            result.messages.some(
                (message) =>
                    message.kind === "agent-text" &&
                    message.text.includes("hello from app-server"),
            ),
        ).toBe(true);
        expect(
            result.messages.some(
                (message) =>
                    message.kind === "agent-text" &&
                    message.text.includes("Plan updated"),
            ),
        ).toBe(true);
        expect(
            result.messages.some(
                (message) =>
                    message.kind === "agent-text" &&
                    message.text.includes("Codex rerouted model from gpt-5.4 to gpt-5.4-mini"),
            ),
        ).toBe(true);
        const diffMessage = result.messages.find(
            (message) =>
                message.kind === "tool-call" &&
                message.tool.name === "CodexDiff",
        );
        expect(diffMessage).toBeDefined();
        if (diffMessage?.kind === "tool-call") {
            expect(diffMessage.tool.state).toBe("completed");
        }
    });

    it("reduces item lifecycle notifications into tool calls and review messages", async () => {
        const itemNotifications = loadCodexAppFixture<FakeRpcMessage[]>(
            "notification_contract_items.json",
        );
        const result = await reduceNotifications([
            {
                method: "turn/started",
                params: {
                    threadId: "thread-1",
                    turn: {
                        id: "turn-fixture-2",
                        items: [],
                        status: "inProgress",
                    },
                },
            },
            ...itemNotifications,
            {
                method: "turn/completed",
                params: {
                    threadId: "thread-1",
                    turn: {
                        id: "turn-fixture-2",
                        items: [],
                        status: "completed",
                        error: null,
                        startedAt: 0,
                        completedAt: 1,
                        durationMs: 1,
                    },
                },
            },
        ]);

        expect(result.hasReadyEvent).toBe(true);
        const toolMessages = result.messages.filter(
            (message) => message.kind === "tool-call",
        );
        expect(toolMessages).toHaveLength(4);
        expect(
            toolMessages.map((message) =>
                message.kind === "tool-call" ? message.tool.name : message.kind,
            ),
        ).toEqual([
            "CodexBash",
            "CodexPatch",
            "mcp__happy__change_title",
            "mcp__happy__change_title",
        ]);
        expect(
            result.messages.some(
                (message) =>
                    message.kind === "agent-text" &&
                    message.text.includes("Review started"),
            ),
        ).toBe(true);
        expect(
            result.messages.some(
                (message) =>
                    message.kind === "agent-text" &&
                    message.text.includes("Review completed"),
            ),
        ).toBe(true);
    });

    it("reduces richer upstream-like notifications into visible review output and ready state", async () => {
        const result = await reduceFixture("notification_contract_upstream_rich.json");

        expect(result.hasReadyEvent).toBe(true);
        expect(
            result.messages.some(
                (message) =>
                    message.kind === "agent-text" &&
                    message.text.includes("dynamic-ok"),
            ),
        ).toBe(true);
        expect(
            result.messages.some(
                (message) =>
                    message.kind === "agent-text" &&
                    message.text.includes("[image] data:image/png;base64,AAA"),
            ),
        ).toBe(true);
        expect(
            result.messages.some(
                (message) =>
                    message.kind === "agent-text" &&
                    message.text.includes("Looks solid overall"),
            ),
        ).toBe(true);
    });
});
