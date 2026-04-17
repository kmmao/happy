/**
 * Happy MCP server
 * Provides Happy CLI specific tools including chat session title management
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";

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
  const progressHandler = async (input: {
    todos: Array<{
      content: string;
      status: "pending" | "in_progress" | "completed";
      stage?: string;
    }>;
    currentStage?: string;
    blockers?: string[];
  }) => {
    logger.debug("[happyMCP] update_progress todos=", input.todos?.length);
    try {
      client.updateMetadata((metadata) => ({
        ...metadata,
        progress: {
          todos: input.todos ?? [],
          currentStage: input.currentStage,
          blockers: input.blockers,
          updatedAt: Date.now(),
        },
      }));
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

    mcp.registerTool(
      "change_title",
      {
        description:
          'Set or update the chat session title. Titles should be short (under 50 chars) and action-oriented, e.g. "Fix auth token refresh".',
        title: "Change Chat Title",
        inputSchema: {
          title: z.string().describe("The new title for the chat session"),
        } as Record<string, any>,
      },
      async (args: any) => {
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
      },
    );

    mcp.registerTool(
      "query_project_knowledge",
      {
        description:
          "Search the project knowledge base for relevant context, past decisions, known pitfalls, and conventions.",
        title: "Query Project Knowledge",
        inputSchema: {
          query: z.string().describe("Search query describing what you want to know"),
        } as Record<string, any>,
      },
      async (args: any) => {
        const query = typeof args.query === "string" ? args.query : "";
        return queryProjectKnowledge(client, query);
      },
    );

    mcp.registerTool(
      "update_progress",
      {
        description:
          'Write the live progress checklist the App shows in the Progress tab. Send the FULL list on every call — the previous list is replaced. Call this after planning, after each status change, and when the plan itself shifts (e.g. moving to a new phase). Prefer this over TodoWrite for user-facing progress: this tool is what the App renders.',
        title: "Update Session Progress",
        inputSchema: {
          todos: z
            .array(
              z.object({
                content: z.string().describe("Concise description of the task"),
                status: z
                  .enum(["pending", "in_progress", "completed"])
                  .describe("Current status of the task"),
                stage: z
                  .string()
                  .optional()
                  .describe("Optional phase/stage label, e.g. 'Phase 2'"),
              }),
            )
            .describe("The full checklist — always send every item, not a delta"),
          currentStage: z
            .string()
            .optional()
            .describe("Optional overall stage name for the checklist"),
          blockers: z
            .array(z.string())
            .optional()
            .describe("Optional list of things blocking progress"),
        } as Record<string, any>,
      },
      async (args: any) => {
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
      },
    );

    mcp.registerTool(
      "update_session_summary",
      {
        description:
          "Write a narrative session summary the App shows above the progress checklist. Call at milestones, not per task: after first understanding the goal, when scope shifts significantly, when key decisions are made, or when moving to a new phase. Full rewrite each call.",
        title: "Update Session Summary",
        inputSchema: {
          goal: z
            .string()
            .describe("What the user ultimately wants to accomplish"),
          currentFocus: z
            .string()
            .optional()
            .describe("Brief description of the active task or phase"),
          keyDecisions: z
            .array(z.string())
            .optional()
            .describe("Important choices already made this session"),
          openQuestions: z
            .array(z.string())
            .optional()
            .describe("Unresolved questions or pending decisions"),
          impactScope: z
            .array(z.string())
            .optional()
            .describe("Modules/files/areas affected by this session's work"),
        } as Record<string, any>,
      },
      async (args: any) => {
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
      },
    );

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
    toolNames: [
      "change_title",
      "query_project_knowledge",
      "update_progress",
      "update_session_summary",
    ],
    stop: () => {
      logger.debug(`[happyMCP] server:stop sessionId=${client.sessionId}`);
      server.close();
    },
  };
}
