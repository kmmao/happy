/**
 * Codex ACP Transport Handler
 *
 * Transport handler for the third-party codex-acp bridge
 * (https://github.com/cola-io/codex-acp).
 *
 * Handles:
 * - Rust binary stderr filtering (RUST_LOG output, tracing spans)
 * - Auth and rate limit error detection
 * - Codex-specific tool name patterns
 *
 * @module CodexAcpTransport
 */

import type {
  TransportHandler,
  ToolPattern,
  StderrContext,
  StderrResult,
  ToolNameContext,
} from "../TransportHandler";
import type { AgentMessage } from "../../core";
import { logger } from "@/ui/logger";

/**
 * Codex ACP timeout values (in milliseconds)
 */
const CODEX_TIMEOUTS = {
  /** codex-acp starts faster than Gemini CLI */
  init: 60_000,
  /** Standard tool call timeout */
  toolCall: 120_000,
  /** Idle detection after last message chunk */
  idle: 500,
} as const;

/**
 * Known tool name patterns for Codex via codex-acp.
 * codex-acp exposes file operations through its built-in acp_fs MCP server.
 */
const CODEX_TOOL_PATTERNS: ToolPattern[] = [
  {
    name: "change_title",
    patterns: [
      "change_title",
      "change-title",
      "happy__change_title",
      "mcp__happy__change_title",
    ],
  },
  {
    name: "shell",
    patterns: ["shell", "bash", "exec"],
  },
  {
    name: "file_read",
    patterns: ["file_read", "read_file", "acp_fs_read"],
  },
  {
    name: "file_write",
    patterns: ["file_write", "write_file", "acp_fs_write"],
  },
  {
    name: "patch",
    patterns: ["patch", "apply_patch", "apply_diff"],
  },
];

/**
 * Codex ACP transport handler.
 *
 * Handles codex-acp (Rust binary) specific quirks:
 * - Rust tracing/log output on stderr
 * - OpenAI API errors (rate limit, auth)
 * - Tool name extraction
 */
export class CodexAcpTransport implements TransportHandler {
  readonly agentName = "codex-acp";

  getInitTimeout(): number {
    return CODEX_TIMEOUTS.init;
  }

  /**
   * Filter codex-acp stdout.
   *
   * codex-acp is a Rust binary that may output tracing logs to stdout
   * when RUST_LOG is set. Only keep valid JSON lines.
   */
  filterStdoutLine(line: string): string | null {
    const trimmed = line.trim();

    if (!trimmed) {
      return null;
    }

    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null) {
        return null;
      }
      return line;
    } catch {
      return null;
    }
  }

  /**
   * Handle codex-acp stderr output.
   *
   * Detects:
   * - Rate limit errors (429)
   * - Auth errors (401/403)
   * - Rust tracing spans (suppress)
   */
  handleStderr(text: string, _context: StderrContext): StderrResult {
    const trimmed = text.trim();
    if (!trimmed) {
      return { message: null, suppress: true };
    }

    // Rust tracing output — suppress
    // Format: "2026-02-27T12:00:00Z DEBUG main: ..." or "DEBUG ..."
    if (
      /^(DEBUG|INFO|WARN|TRACE)\b/.test(trimmed) ||
      /^\d{4}-\d{2}-\d{2}T.*?\s(DEBUG|INFO|WARN|TRACE)\s/.test(trimmed)
    ) {
      return { message: null, suppress: true };
    }

    // Rate limit (429)
    if (
      trimmed.includes("status 429") ||
      trimmed.includes("rate_limit") ||
      trimmed.includes("Rate limit")
    ) {
      return { message: null, suppress: false };
    }

    // Auth error (401/403)
    if (
      trimmed.includes("status 401") ||
      trimmed.includes("status 403") ||
      trimmed.includes("Unauthorized") ||
      trimmed.includes("invalid_api_key")
    ) {
      const errorMessage: AgentMessage = {
        type: "status",
        status: "error",
        detail:
          "OpenAI authentication failed. Check your API key or run `codex login`.",
      };
      return { message: errorMessage };
    }

    return { message: null };
  }

  getToolPatterns(): ToolPattern[] {
    return CODEX_TOOL_PATTERNS;
  }

  getToolCallTimeout(_toolCallId: string, _toolKind?: string): number {
    return CODEX_TIMEOUTS.toolCall;
  }

  getIdleTimeout(): number {
    return CODEX_TIMEOUTS.idle;
  }

  extractToolNameFromId(toolCallId: string): string | null {
    const lowerId = toolCallId.toLowerCase();

    for (const toolPattern of CODEX_TOOL_PATTERNS) {
      for (const pattern of toolPattern.patterns) {
        if (lowerId.includes(pattern.toLowerCase())) {
          return toolPattern.name;
        }
      }
    }

    return null;
  }

  /**
   * Determine the real tool name when codex-acp reports "other" or "Unknown tool".
   *
   * Tries to extract the tool name from toolCallId patterns.
   */
  determineToolName(
    toolName: string,
    toolCallId: string,
    _input: Record<string, unknown>,
    _context: ToolNameContext,
  ): string {
    if (toolName !== "other" && toolName !== "Unknown tool") {
      return toolName;
    }

    const extracted = this.extractToolNameFromId(toolCallId);
    if (extracted) {
      return extracted;
    }

    logger.debug(
      `[CodexAcpTransport] Unknown tool pattern - toolCallId: "${toolCallId}", toolName: "${toolName}".`,
    );

    return toolName;
  }
}

/**
 * Singleton instance for convenience
 */
export const codexAcpTransport = new CodexAcpTransport();
