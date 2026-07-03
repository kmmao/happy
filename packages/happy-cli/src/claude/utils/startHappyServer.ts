/**
 * Happy MCP server
 * Provides Happy CLI specific tools including chat session title management
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import { createAskUserRegistry } from "@/claude/utils/askUserRegistry";
import {
  buildAutoSummarySyntheticPrompt,
  HAPPY_AUTO_SUMMARY_SOURCE,
} from "@/utils/progressAutomation";
import { applyHappyProgressUpdate } from "@/utils/happyProgressMetadata";
import { applySessionSummaryUpdate } from "@/utils/sessionSummaryMetadata";
import {
  HAPPY_MCP_TOOL_NAMES,
  HAPPY_MCP_TOOL_SPECS,
  type HappyMcpCanonicalToolName,
  type AskUserResponseRequest,
} from "@kmmao/happy-wire";

type McpTextResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
};

export async function queryProjectKnowledge(
  client: Pick<ApiSessionClient, "fetchKnowledge">,
  query: string,
): Promise<McpTextResponse> {
  try {
    const result = await client.fetchKnowledge("auto", [query]);
    if (!result || result.entries.length === 0) {
      return {
        content: [{ type: "text", text: "No relevant knowledge found." }],
        isError: false,
      };
    }

    const lines = result.entries.map((entry) =>
      `[${entry.entryType}] ${entry.title} (${entry.confidence})\n${entry.content.slice(0, 500)}`,
    );

    return {
      content: [{ type: "text", text: lines.join("\n\n") }],
      isError: false,
    };
  } catch (error) {
    logger.debug(`[happyMCP] query_project_knowledge failed: ${error}`);
    return {
      content: [{ type: "text", text: "Knowledge query failed." }],
      isError: true,
    };
  }
}

/**
 * 30 minutes — bound on how long an `ask_user` MCP handler will block waiting
 * for the user to answer in the App. The MCP SDK has no native timeout, so we
 * roll our own to keep Claude TUI from sitting on a tool_use forever if the
 * user closes the App without answering. Pick a window long enough that a user
 * who walks away mid-conversation can still come back and reply.
 */
const ASK_USER_TIMEOUT_MS = 30 * 60 * 1000;

export async function startHappyServer(client: ApiSessionClient) {
  logger.debug(`[happyMCP] server:start sessionId=${client.sessionId}`);

  // Pending `mcp__happy__ask_user` invocations, keyed by askId. The MCP tool
  // handler inserts an entry then awaits its resolver; the App posts the user's
  // answers via the `ask_user_response` RPC which looks the entry up and
  // resolves it. On session teardown all surviving entries are rejected so the
  // MCP handler returns isError instead of hanging the next turn.
  const askUserRegistry = createAskUserRegistry();

  const rejectAllPendingAskUser = (reason: string) => {
    if (askUserRegistry.size === 0) return;
    logger.debug(
      `[happyMCP] ask_user: rejecting ${askUserRegistry.size} pending entries (${reason})`,
    );
    askUserRegistry.rejectAll(reason);
  };

  // Handler that sends title updates via the client
  const handler = async (title: string) => {
    logger.debug("[happyMCP] Changing title to:", title);
    try {
      // Send title as a summary message, similar to title generator
      client.sendClaudeSessionMessage({
        type: "summary",
        summary: title,
        leafUuid: randomUUID(),
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  };

  // Handler that writes a structured progress checklist into session metadata.
  // The App subscribes to metadata updates and re-renders the Progress tab.
  //
  // Most of the time the auto-mirror hook (see claudeRemoteLauncher) handles
  // checklist sync from TodoWrite directly. This MCP path is an optional
  // Agent-driven override for richer fields (currentStage, blockers) and
  // explicit list boundary control via `listId: "new" | "<uuid>"`.
  const progressHandler = async (input: {
    todos: Array<{
      content: string;
      status: "pending" | "in_progress" | "completed";
      activeForm?: string;
      stage?: string;
    }>;
    currentStage?: string;
    blockers?: string[];
    listId?: string;
    label?: string;
  }) => {
    logger.debug(
      "[happyMCP] update_progress todos=",
      input.todos?.length,
      "listId=",
      input.listId,
    );
    try {
      const sanitizedTodos = (input.todos ?? []).map((t) => ({
        content: t.content,
        status: t.status,
        activeForm: t.activeForm,
        stage: t.stage,
      }));
      let shouldTriggerAutoSummary = false;
      client.updateMetadata((metadata) => {
        const result = applyHappyProgressUpdate(metadata, {
          todos: sanitizedTodos,
          currentStage: input.currentStage,
          blockers: input.blockers,
          listId: input.listId,
          label: input.label,
          createId: randomUUID,
        });
        shouldTriggerAutoSummary = result.shouldTriggerAutoSummary;
        return result.metadata;
      });
      if (shouldTriggerAutoSummary) {
        client.sendSyntheticUserMessage(buildAutoSummarySyntheticPrompt(), {
          displayText: "",
          sentFrom: HAPPY_AUTO_SUMMARY_SOURCE,
        });
      }
      return { success: true as const };
    } catch (error) {
      return { success: false as const, error: String(error) };
    }
  };

  // Handler that writes a narrative session summary into session metadata.
  const summaryHandler = async (input: {
    goal: string;
    currentFocus?: string;
    keyDecisions?: string[];
    openQuestions?: string[];
    impactScope?: string[];
    requestId?: string;
  }) => {
    logger.debug(
      "[happyMCP] update_session_summary goal=",
      input.goal,
      "requestId=",
      input.requestId,
    );
    try {
      client.updateMetadata((metadata) =>
        applySessionSummaryUpdate(metadata, input),
      );
      return { success: true as const };
    } catch (error) {
      return { success: false as const, error: String(error) };
    }
  };

  // The App's AskUserQuestionView calls `ask_user_response` when the user
  // submits answers for an `mcp__happy__ask_user` prompt. We resolve the
  // matching pendingAskUser entry so the MCP handler's await returns and
  // Claude TUI receives the user's answers as the tool result.
  //
  // Registered unconditionally (both SDK and PTY modes) — the handler is a
  // no-op for any askId we don't recognise. Conversely the `permission` RPC
  // (SDK-mode only) is left untouched: native AskUserQuestion still rides
  // its own path so the two channels cannot interfere.
  client.rpcHandlerManager.registerHandler<AskUserResponseRequest, { ok: true }>(
    "ask_user_response",
    async (req) => {
      // Settle the pending ask via the registry. `canceled` (the picker's
      // "取消选择" button) rejects so the tool handler's catch path records a
      // canceled completedRequest and returns isError to Claude TUI; otherwise
      // resolve with the answers. A false return means no live entry (already
      // resolved or expired) — a no-op, matching the prior guard.
      const settled = req.canceled
        ? askUserRegistry.reject(
            req.askId,
            "User declined to answer this question",
          )
        : askUserRegistry.resolve(req.askId, req.answers ?? {});
      if (!settled) {
        logger.debug(
          `[happyMCP] ask_user_response: no pending entry for askId=${req.askId} (likely already resolved or expired)`,
        );
      } else if (req.canceled) {
        logger.debug(
          `[happyMCP] ask_user_response: user declined askId=${req.askId}`,
        );
      }
      return { ok: true };
    },
  );

  //
  // Create a per-request MCP server factory
  // @modelcontextprotocol/sdk >= 1.26.0 forbids reusing a stateless
  // StreamableHTTPServerTransport across requests, so we create a fresh
  // McpServer + transport for each incoming request (following the SDK's
  // own simpleStatelessStreamableHttp.ts example).
  //

  function createMcpServer(): McpServer {
    const mcp = new McpServer({
      name: "Happy MCP",
      version: "1.0.0",
    });

    // MCP SDK passes a `RequestHandlerExtra` as the second arg to tool handlers.
    // We expose only the pieces we currently consume — the cancellation signal,
    // the per-request progressToken (optional, sent by clients that opted into
    // progress notifications), and `sendNotification` for emitting heartbeats.
    type HappyToolExtra = {
      signal: AbortSignal;
      sendNotification: (notification: {
        method: "notifications/progress";
        params: { progressToken: string | number; progress: number; total?: number };
      }) => Promise<void>;
      _meta?: { progressToken?: string | number };
    };

    const registerHappyTool = (
      name: HappyMcpCanonicalToolName,
      handler: (
        args: any,
        extra: HappyToolExtra,
      ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean }>,
    ) => {
      const spec = HAPPY_MCP_TOOL_SPECS[name];
      mcp.registerTool(
        name,
        {
          description: spec.description,
          title: spec.title,
          inputSchema: spec.inputSchema as Record<string, any>,
        },
        handler as any,
      );
    };

    registerHappyTool("change_title", async (args: any) => {
        const response = await handler(args.title);
        logger.debug("[happyMCP] Response:", response);

        if (response.success) {
          return {
            content: [
              {
                type: "text",
                text: `Successfully changed chat title to: "${args.title}"`,
              },
            ],
            isError: false,
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Failed to change chat title: ${response.error || "Unknown error"}`,
              },
            ],
            isError: true,
          };
        }
      });

    registerHappyTool("query_project_knowledge", async (args: any) => {
        const query = typeof args.query === "string" ? args.query : "";
        return queryProjectKnowledge(client, query);
      });

    registerHappyTool("update_progress", async (args: any) => {
        const response = await progressHandler(args);
        if (response.success) {
          const count = Array.isArray(args?.todos) ? args.todos.length : 0;
          return {
            content: [
              { type: "text", text: `Progress updated (${count} items).` },
            ],
            isError: false,
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Failed to update progress: ${response.error || "Unknown error"}`,
            },
          ],
          isError: true,
        };
      });

    registerHappyTool("ask_user", async (args: any, extra) => {
      const questions = args?.questions;
      if (!Array.isArray(questions) || questions.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "ask_user requires a non-empty `questions` array.",
            },
          ],
          isError: true,
        };
      }

      const askId = randomUUID();
      logger.debug(
        `[happyMCP] ask_user start askId=${askId} questions=${questions.length}`,
      );

      // Surface as a pending agentState.requests entry. The App reducer
      // (Phase 0) auto-creates a tool message from this and routes it through
      // the mcp__happy__ask_user knownTools entry, which mirrors AskUserQuestion's
      // picker UI. The App distinguishes ours from native AskUserQuestion by the
      // tool name so its submit handler calls `ask_user_response` instead of the
      // SDK-only `permission` RPC.
      client.updateAgentState((state) => ({
        ...state,
        requests: {
          ...(state.requests ?? {}),
          [askId]: {
            tool: "mcp__happy__ask_user",
            arguments: { questions },
            createdAt: Date.now(),
          },
        },
      }));

      const cleanupRequestEntry = (
        outcome: { status: "approved" | "canceled" | "denied"; answers?: Record<string, string>; reason?: string },
      ) => {
        client.updateAgentState((state) => {
          const requests = { ...(state.requests ?? {}) };
          const pendingEntry = requests[askId];
          delete requests[askId];
          const completedBase = pendingEntry ?? {
            tool: "mcp__happy__ask_user",
            arguments: { questions },
            createdAt: Date.now(),
          };
          return {
            ...state,
            requests,
            completedRequests: {
              ...(state.completedRequests ?? {}),
              [askId]: {
                ...completedBase,
                completedAt: Date.now(),
                status: outcome.status,
                ...(outcome.reason ? { reason: outcome.reason } : {}),
                ...(outcome.answers ? { answers: outcome.answers } : {}),
              },
            },
          };
        });
      };

      // MCP clients (notably Claude Code TUI) enforce their own per-request
      // timeout — DEFAULT_REQUEST_TIMEOUT_MSEC is 60s in the official SDK and
      // is not configurable from the server side. Two complementary defences:
      //
      // 1. Heartbeat: emit `notifications/progress` every 30s. Clients that
      //    opted into `resetTimeoutOnProgress` (Claude Code does, when a
      //    progressToken is present on the request) reset their timer on each
      //    one, letting the user take as long as they need. We only beat when
      //    we actually got a progressToken — sending without one is a protocol
      //    error.
      //
      // 2. Abort signal: when the client decides the request is dead anyway
      //    (network drop, user-side cancel, or its own ceiling), the SDK fires
      //    `extra.signal`. Reject the pending entry so the App's picker UI
      //    leaves pending state (reducer turns it into a `canceled` completed
      //    request, AskUserQuestionView flips to SubmittedView) instead of
      //    sitting on a phantom prompt for a tool result that will never be
      //    accepted.
      const progressToken = extra._meta?.progressToken;
      const startMs = Date.now();
      let heartbeat: NodeJS.Timeout | null = null;
      if (progressToken !== undefined) {
        heartbeat = setInterval(() => {
          extra
            .sendNotification({
              method: "notifications/progress",
              params: { progressToken, progress: Date.now() - startMs },
            })
            .catch((err) => {
              logger.debug(
                `[happyMCP] ask_user progress send failed askId=${askId}: ${err}`,
              );
            });
        }, 30_000);
      }

      const onAbort = () => {
        askUserRegistry.reject(
          askId,
          "MCP client aborted the request (likely TUI-side timeout or cancel)",
        );
      };
      extra.signal.addEventListener("abort", onAbort);

      try {
        const answers = await askUserRegistry.register(askId, ASK_USER_TIMEOUT_MS);

        cleanupRequestEntry({ status: "approved", answers });
        logger.debug(
          `[happyMCP] ask_user resolved askId=${askId} answerKeys=${Object.keys(answers).length}`,
        );

        return {
          content: [{ type: "text", text: JSON.stringify(answers) }],
          isError: false,
        };
      } catch (err) {
        const reason = (err as Error).message;
        cleanupRequestEntry({ status: "canceled", reason });
        logger.debug(`[happyMCP] ask_user failed askId=${askId}: ${reason}`);
        return {
          content: [{ type: "text", text: `ask_user failed: ${reason}` }],
          isError: true,
        };
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        extra.signal.removeEventListener("abort", onAbort);
      }
    });

    registerHappyTool("report_preview", async (args: any) => {
        const sessionId = client.sessionId;
        if (!sessionId) {
          return {
            content: [{ type: "text", text: "No active session for preview report." }],
            isError: true,
          };
        }
        try {
          const report = {
            sessionId,
            protocol: args.protocol ?? "http",
            host: args.host ?? "127.0.0.1",
            port: args.port,
            path: args.path,
            devServerType: args.devServerType,
            command: args.command,
            cwd: args.cwd,
            pid: args.pid,
          };
          // Report to server via the session socket
          const result = await client.emitPreviewCandidateReport(report);
          if (result?.ok) {
            return {
              content: [{
                type: "text",
                text: `Preview candidate reported (${report.host}:${report.port}). The user can now open the Preview tab to view it.`,
              }],
              isError: false,
            };
          }
          return {
            content: [{ type: "text", text: `Preview report rejected: ${result?.error ?? "unknown error"}` }],
            isError: true,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Failed to report preview: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      });

    registerHappyTool("update_session_summary", async (args: any) => {
        const response = await summaryHandler(args);
        if (response.success) {
          return {
            content: [{ type: "text", text: "Session summary updated." }],
            isError: false,
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Failed to update session summary: ${response.error || "Unknown error"}`,
            },
          ],
          isError: true,
        };
      });

    return mcp;
  }

  //
  // Create the HTTP server
  //

  const server = createServer(async (req, res) => {
    const mcp = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await mcp.connect(transport);
    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.debug("Error handling request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end();
      }
    }
    res.on("close", () => {
      transport.close();
      mcp.close();
    });
  });

  const baseUrl = await new Promise<URL>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(new URL(`http://127.0.0.1:${addr.port}`));
    });
  });

  logger.debug(
    `[happyMCP] server:ready sessionId=${client.sessionId} url=${baseUrl.toString()}`,
  );

  return {
    url: baseUrl.toString(),
    toolNames: [...HAPPY_MCP_TOOL_NAMES],
    stop: () => {
      logger.debug(`[happyMCP] server:stop sessionId=${client.sessionId}`);
      rejectAllPendingAskUser("Happy MCP server stopped");
      server.close();
    },
  };
}
