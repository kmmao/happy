import { exec } from "child_process";
import { promisify } from "util";
import { RpcHandlerManager } from "../../api/rpc/RpcHandlerManager";

const execAsync = promisify(exec);

// ── Curated MCP server catalog ──
const MCP_CATALOG = [
  // Development tools
  { name: "github", pkg: "@modelcontextprotocol/server-github", description: "GitHub API — issues, PRs, repos, code search", category: "dev" },
  { name: "playwright", pkg: "@playwright/mcp", description: "Browser automation and E2E testing by Microsoft", category: "dev" },
  { name: "filesystem", pkg: "@modelcontextprotocol/server-filesystem", description: "Read/write/search local files securely", category: "dev" },
  { name: "chrome-devtools", pkg: "chrome-devtools-mcp", description: "Control and inspect a live Chrome browser", category: "dev" },
  // Knowledge & search
  { name: "context7", pkg: "@upstash/context7-mcp", description: "Up-to-date library documentation lookup", category: "knowledge" },
  { name: "brave-search", pkg: "@anthropic-ai/mcp-server-brave-search", description: "Web search via Brave Search API", category: "search", envHint: "BRAVE_API_KEY" },
  { name: "fetch", pkg: "@anthropic-ai/mcp-server-fetch", description: "Fetch and extract content from URLs", category: "knowledge" },
  // Database
  { name: "postgres", pkg: "@anthropic-ai/mcp-server-postgres", description: "Query and manage PostgreSQL databases", category: "database", envHint: "DATABASE_URL" },
  { name: "supabase", pkg: "@supabase/mcp-server-supabase", description: "Supabase database, auth, and storage", category: "database", envHint: "SUPABASE_ACCESS_TOKEN" },
  { name: "sqlite", pkg: "@anthropic-ai/mcp-server-sqlite", description: "Query and manage SQLite databases", category: "database" },
  // Memory & thinking
  { name: "memory", pkg: "@anthropic-ai/mcp-server-memory", description: "Persistent memory using knowledge graphs", category: "utility" },
  { name: "sequential-thinking", pkg: "@anthropic-ai/mcp-server-sequential-thinking", description: "Step-by-step reasoning and problem solving", category: "utility" },
  // Platforms
  { name: "notion", pkg: "@notionhq/notion-mcp-server", description: "Official Notion API — pages, databases, blocks", category: "platform", envHint: "NOTION_API_KEY" },
  { name: "slack", pkg: "@anthropic-ai/mcp-server-slack", description: "Slack channels, messages, and threads", category: "platform", envHint: "SLACK_BOT_TOKEN" },
  { name: "sentry", pkg: "@sentry/mcp-server", description: "Sentry error tracking and monitoring", category: "platform" },
  { name: "railway", pkg: "@railway/mcp-server", description: "Railway deployment and infrastructure", category: "platform" },
  { name: "heroku", pkg: "@heroku/mcp-server", description: "Heroku platform management", category: "platform" },
];

/**
 * Register MCP-server discovery RPC handlers: listMcpServers (parses
 * `claude mcp list`) and listAvailableMcpServers (the curated catalog with an
 * installed flag). Self-contained — shells out to the `claude` CLI only.
 */
export function registerMcpHandlers(rpcHandlerManager: RpcHandlerManager) {
  // ── List MCP servers ──
  rpcHandlerManager.registerHandler("listMcpServers", async () => {
    try {
      const { stdout } = await execAsync("claude mcp list", {
        timeout: 15000,
        env: { ...process.env, NO_COLOR: "1" },
      });

      // Parse output like:
      //   context7: npx -y @upstash/context7-mcp - ✓ Connected
      //   github: npx -y @modelcontextprotocol/server-github - ✓ Connected
      interface McpServerInfo {
        name: string;
        command: string;
        status: "connected" | "disconnected" | "error";
      }

      const servers: McpServerInfo[] = [];
      const lines = stdout.split("\n");
      for (const line of lines) {
        // Match: name: command - status
        const match = line.match(
          /^\s*(\S+):\s+(.+?)\s+-\s+(?:✓|✔)\s+Connected\s*$/,
        );
        if (match) {
          servers.push({
            name: match[1],
            command: match[2].trim(),
            status: "connected",
          });
          continue;
        }
        // Disconnected or error
        const matchDisc = line.match(
          /^\s*(\S+):\s+(.+?)\s+-\s+(?:✗|✘|⚠)\s+(.+)$/,
        );
        if (matchDisc) {
          servers.push({
            name: matchDisc[1],
            command: matchDisc[2].trim(),
            status: matchDisc[3].toLowerCase().includes("error")
              ? "error"
              : "disconnected",
          });
        }
      }

      return { servers };
    } catch {
      return { servers: [] };
    }
  });

  rpcHandlerManager.registerHandler("listAvailableMcpServers", async () => {
    // Get currently installed server names
    let installedNames: Set<string>;
    try {
      const { stdout } = await execAsync("claude mcp list", {
        timeout: 15000,
        env: { ...process.env, NO_COLOR: "1" },
      });
      installedNames = new Set(
        stdout
          .split("\n")
          .map((line) => line.match(/^\s*(\S+):/)?.[1])
          .filter((name): name is string => !!name),
      );
    } catch {
      installedNames = new Set();
    }

    return {
      servers: MCP_CATALOG.map((s) => ({
        ...s,
        installed: installedNames.has(s.name),
      })),
    };
  });
}
