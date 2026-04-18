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
import {
  buildAutoSummarySyntheticPrompt,
  didChecklistTransitionToCompleted,
  HAPPY_AUTO_SUMMARY_SOURCE,
} from "@/utils/progressAutomation";
import {
  HAPPY_MCP_TOOL_NAMES,
  HAPPY_MCP_TOOL_SPECS,
  type HappyMcpCanonicalToolName,
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

export async function startHappyServer(client: ApiSessionClient) {
  logger.debug(`[happyMCP] server:start sessionId=${client.sessionId}`);

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
        const now = Date.now();
        const prior = metadata.progress;
        const lists = prior?.lists ? [...prior.lists] : [];
        const priorCurrentId = prior?.currentListId;

        // Resolve target list:
        //   - listId === "new" → create fresh list (archive prior current)
        //   - listId matches existing → update that one
        //   - unspecified → update currentListId (or create first list)
        let targetId: string;
        let nextLists = lists;
        let priorTargetTodos = prior?.todos ?? [];
        let priorTargetSummaryGeneratedAt: number | undefined;
        let targetCanTriggerSummary = false;

        if (input.listId === "new") {
          if (priorCurrentId) {
            nextLists = nextLists.map((l) =>
              l.id === priorCurrentId ? { ...l, archivedAt: now } : l,
            );
          }
          targetId = randomUUID();
          nextLists = [
            ...nextLists,
            {
              id: targetId,
              label: input.label,
              todos: sanitizedTodos,
              currentStage: input.currentStage,
              blockers: input.blockers,
              startedAt: now,
              updatedAt: now,
            },
          ];
        } else {
          const explicitIdx = input.listId
            ? nextLists.findIndex((l) => l.id === input.listId)
            : priorCurrentId
              ? nextLists.findIndex((l) => l.id === priorCurrentId)
              : -1;
          if (explicitIdx >= 0) {
            const target = nextLists[explicitIdx]!;
            targetId = target.id;
            priorTargetTodos = target.todos;
            priorTargetSummaryGeneratedAt = target.summaryGeneratedAt;
            targetCanTriggerSummary = targetId === priorCurrentId;
            nextLists = nextLists.map((l, i) =>
              i === explicitIdx
                ? {
                    ...l,
                    todos: sanitizedTodos,
                    currentStage: input.currentStage ?? l.currentStage,
                    blockers: input.blockers ?? l.blockers,
                    label: input.label ?? l.label,
                    updatedAt: now,
                  }
                : l,
            );
          } else {
            targetId = randomUUID();
            nextLists = [
              ...nextLists,
              {
                id: targetId,
                label: input.label,
                todos: sanitizedTodos,
                currentStage: input.currentStage,
                blockers: input.blockers,
                startedAt: now,
                updatedAt: now,
              },
            ];
          }
        }

        if (
          targetCanTriggerSummary &&
          didChecklistTransitionToCompleted({
            priorTodos: priorTargetTodos,
            nextTodos: sanitizedTodos,
            alreadyGenerated: priorTargetSummaryGeneratedAt !== undefined,
          })
        ) {
          shouldTriggerAutoSummary = true;
          nextLists = nextLists.map((l) =>
            l.id === targetId ? { ...l, summaryGeneratedAt: now } : l,
          );
        }

        const active =
          nextLists.find((l) => l.id === targetId) ??
          nextLists[nextLists.length - 1];

        return {
          ...metadata,
          progress: {
            lists: nextLists,
            currentListId: targetId,
            todos: active?.todos ?? sanitizedTodos,
            currentStage: active?.currentStage,
            blockers: active?.blockers,
            updatedAt: now,
          },
        };
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
  }) => {
    logger.debug("[happyMCP] update_session_summary goal=", input.goal);
    try {
      client.updateMetadata((metadata) => ({
        ...metadata,
        sessionSummary: {
          goal: input.goal,
          currentFocus: input.currentFocus,
          keyDecisions: input.keyDecisions,
          openQuestions: input.openQuestions,
          impactScope: input.impactScope,
          updatedAt: Date.now(),
        },
      }));
      return { success: true as const };
    } catch (error) {
      return { success: false as const, error: String(error) };
    }
  };

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

    const registerHappyTool = (
      name: HappyMcpCanonicalToolName,
      handler: (args: any) => Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean }>,
    ) => {
      const spec = HAPPY_MCP_TOOL_SPECS[name];
      mcp.registerTool(
        name,
        {
          description: spec.description,
          title: spec.title,
          inputSchema: spec.inputSchema as Record<string, any>,
        },
        handler,
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
      server.close();
    },
  };
}
