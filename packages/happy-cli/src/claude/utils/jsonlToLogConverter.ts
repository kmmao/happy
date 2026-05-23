/**
 * Converter from SDK message types to log format (RawJSONLines)
 * Transforms Claude SDK messages into the format expected by session logs
 */

import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import type {
  ClaudeJsonlMessage,
  ClaudeJsonlUserMessage,
  ClaudeJsonlAssistantMessage,
  ClaudeJsonlSystemMessage,
} from "@/claude/jsonl";
import type { RawJSONLines } from "@/claude/types";

/**
 * Type guard: checks if an SDK message has parent_tool_use_id.
 * Many SDK message subtypes carry this field, but not all union members.
 */
function hasParentToolUseId(
  msg: ClaudeJsonlMessage,
): msg is ClaudeJsonlMessage & { parent_tool_use_id: string | null } {
  return "parent_tool_use_id" in msg;
}

/**
 * Extended assistant message with runtime-only `requestId` field
 * that the SDK type doesn't declare but Claude Code emits at runtime.
 */
type ExtendedSDKAssistantMessage = ClaudeJsonlAssistantMessage & {
  requestId?: string;
};

/**
 * Context for converting SDK messages to log format
 */
export interface ConversionContext {
  sessionId: string;
  cwd: string;
  version?: string;
  gitBranch?: string;
  parentUuid?: string | null;
}

/**
 * Get current git branch for the working directory
 */
function getGitBranch(cwd: string): string | undefined {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

/**
 * SDK to Log converter class
 * Maintains state for parent-child relationships between messages
 */
export class ClaudeJsonlToLogConverter {
  private lastUuid: string | null = null;
  private context: ConversionContext;
  private responses?: Map<
    string,
    {
      approved: boolean;
      mode?:
        | "default"
        | "acceptEdits"
        | "bypassPermissions"
        | "plan"
        | "dontAsk"
        | "auto";
      reason?: string;
    }
  >;
  private sidechainLastUUID = new Map<string, string>();

  constructor(
    context: Omit<ConversionContext, "parentUuid">,
    responses?: Map<
      string,
      {
        approved: boolean;
        mode?:
          | "default"
          | "acceptEdits"
          | "bypassPermissions"
          | "plan"
          | "dontAsk"
        | "auto";
        reason?: string;
      }
    >,
  ) {
    this.context = {
      ...context,
      gitBranch: context.gitBranch ?? getGitBranch(context.cwd),
      version: context.version ?? process.env.npm_package_version ?? "0.0.0",
      parentUuid: null,
    };
    this.responses = responses;
  }

  /**
   * Update session ID (for when session changes during resume)
   */
  updateSessionId(sessionId: string): void {
    this.context.sessionId = sessionId;
  }

  /**
   * Reset parent chain (useful when starting new conversation)
   */
  resetParentChain(): void {
    this.lastUuid = null;
    this.context.parentUuid = null;
  }

  /**
   * Convert SDK message to log format
   */
  convert(jsonlMessage: ClaudeJsonlMessage): RawJSONLines | null {
    const uuid = randomUUID();
    const timestamp = new Date().toISOString();
    let parentUuid = this.lastUuid;
    let isSidechain = false;
    if (hasParentToolUseId(jsonlMessage) && jsonlMessage.parent_tool_use_id) {
      isSidechain = true;
      parentUuid =
        this.sidechainLastUUID.get(jsonlMessage.parent_tool_use_id) ?? null;
      this.sidechainLastUUID.set(jsonlMessage.parent_tool_use_id, uuid);
    }
    const baseFields = {
      parentUuid: parentUuid,
      isSidechain: isSidechain,
      userType: "external" as const,
      cwd: this.context.cwd,
      sessionId: this.context.sessionId,
      version: this.context.version,
      gitBranch: this.context.gitBranch,
      uuid,
      timestamp,
    };

    let logMessage: RawJSONLines | null = null;

    switch (jsonlMessage.type) {
      case "user": {
        const userMsg = jsonlMessage as ClaudeJsonlUserMessage;
        // The SDK marks context-only injections (e.g. Skill tool
        // feeding the skill body back into the conversation) as
        // `isSynthetic: true` in memory; on disk claude writes the
        // equivalent flag as `isMeta`. The downstream mapper and
        // happy-app both already short-circuit on `isMeta`, so
        // forward the same signal whichever shape we received.
        const meta =
          (userMsg as any).isSynthetic === true ||
          (userMsg as any).isMeta === true;
        logMessage = {
          ...baseFields,
          type: "user",
          message: { ...userMsg.message },
          ...(userMsg.parent_tool_use_id
            ? { parent_tool_use_id: userMsg.parent_tool_use_id }
            : {}),
          ...(meta ? { isMeta: true } : {}),
        };

        // Check if this is a tool result and add mode if available
        if (Array.isArray(userMsg.message.content)) {
          for (const content of userMsg.message.content) {
            if (
              content.type === "tool_result" &&
              content.tool_use_id &&
              this.responses?.has(content.tool_use_id)
            ) {
              const response = this.responses.get(content.tool_use_id);
              if (response?.mode) {
                (logMessage as RawJSONLines & { mode?: string }).mode =
                  response.mode;
              }
            }
          }
        } else if (typeof userMsg.message.content === "string") {
          // Simple string content, no tool result
        }
        break;
      }

      case "assistant": {
        const assistantMsg = jsonlMessage as ExtendedSDKAssistantMessage;
        logMessage = {
          ...baseFields,
          type: "assistant",
          message: assistantMsg.message as unknown as Record<string, unknown>,
          // requestId is emitted at runtime but not in SDK type definitions
          requestId: assistantMsg.requestId,
          ...(assistantMsg.parent_tool_use_id
            ? { parent_tool_use_id: assistantMsg.parent_tool_use_id }
            : {}),
        };
        // if (assistantMsg.message.content && Array.isArray(assistantMsg.message.content)) {
        //     for (const content of assistantMsg.message.content) {
        //         if (content.type === 'tool_use' && content.id) {
        //             this.sidechainLastUUID.set(content.id, uuid);
        //         }
        //     }
        // }
        break;
      }

      case "system": {
        const systemMsg = jsonlMessage as ClaudeJsonlSystemMessage;

        // System messages with subtype 'init' might update session ID
        if (systemMsg.subtype === "init" && systemMsg.session_id) {
          this.updateSessionId(systemMsg.session_id);
        }

        // System messages are typically not sent to logs
        // but we can convert them if needed
        logMessage = {
          ...baseFields,
          type: "system",
          subtype: systemMsg.subtype,
          model: systemMsg.model,
          tools: systemMsg.tools,
          // Include all other fields from the system message
          ...(systemMsg as unknown as Record<string, unknown>),
        };
        break;
      }

      case "result": {
        // Result messages are not converted to log messages
        // They're SDK-specific messages that indicate session completion
        // Not part of the actual conversation log
        break;
      }

      // Note: "tool_result" is not a standalone ClaudeJsonlMessage type in the SDK;
      // tool results arrive as content inside "user" messages (handled above).

      default:
        // Unknown message type - pass through with all fields
        logMessage = {
          ...baseFields,
          ...(jsonlMessage as unknown as Record<string, unknown>),
          type: (jsonlMessage as ClaudeJsonlMessage & { type: string }).type,
        } as RawJSONLines;
    }

    // Update last UUID for parent tracking
    if (logMessage && logMessage.type !== "summary") {
      this.lastUuid = uuid;
    }

    return logMessage;
  }

  /**
   * Convert multiple SDK messages to log format
   */
  convertMany(jsonlMessages: ClaudeJsonlMessage[]): RawJSONLines[] {
    return jsonlMessages
      .map((msg) => this.convert(msg))
      .filter((msg): msg is RawJSONLines => msg !== null);
  }

  /**
   * Convert a simple string content to a sidechain user message
   * Used for Task tool sub-agent prompts
   */
  convertSidechainUserMessage(
    toolUseId: string,
    content: string,
  ): RawJSONLines {
    const uuid = randomUUID();
    const timestamp = new Date().toISOString();
    this.sidechainLastUUID.set(toolUseId, uuid);
    return {
      parentUuid: null,
      isSidechain: true,
      parent_tool_use_id: toolUseId,
      userType: "external" as const,
      cwd: this.context.cwd,
      sessionId: this.context.sessionId,
      version: this.context.version,
      gitBranch: this.context.gitBranch,
      type: "user",
      message: {
        role: "user",
        content: content,
      },
      uuid,
      timestamp,
    };
  }

  /**
   * Generate an interrupted tool result message
   * Used when a tool call is interrupted by the user
   * @param toolUseId - The ID of the tool that was interrupted
   * @param parentToolUseId - Optional parent tool ID if this is a sidechain tool
   */
  generateInterruptedToolResult(
    toolUseId: string,
    parentToolUseId?: string | null,
  ): RawJSONLines {
    const uuid = randomUUID();
    const timestamp = new Date().toISOString();
    const errorMessage = "[Request interrupted by user for tool use]";

    // Determine if this is a sidechain and get parent UUID
    let isSidechain = false;
    let parentUuid: string | null = this.lastUuid;

    if (parentToolUseId) {
      isSidechain = true;
      // Look up the parent tool's UUID
      parentUuid = this.sidechainLastUUID.get(parentToolUseId) ?? null;
      // Track this tool in the sidechain map
      this.sidechainLastUUID.set(parentToolUseId, uuid);
    }

    const logMessage = {
      type: "user" as const,
      isSidechain: isSidechain,
      ...(parentToolUseId ? { parent_tool_use_id: parentToolUseId } : {}),
      uuid,
      message: {
        role: "user" as const,
        content: [
          {
            type: "tool_result" as const,
            content: errorMessage,
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
      },
      parentUuid: parentUuid,
      userType: "external" as const,
      cwd: this.context.cwd,
      sessionId: this.context.sessionId,
      version: this.context.version,
      gitBranch: this.context.gitBranch,
      timestamp,
      toolUseResult: `Error: ${errorMessage}`,
    } satisfies Record<string, unknown> as unknown as RawJSONLines;

    // Update last UUID for tracking
    this.lastUuid = uuid;

    return logMessage;
  }
}

/**
 * Convenience function for one-off conversions
 */
export function convertSDKToLog(
  jsonlMessage: ClaudeJsonlMessage,
  context: Omit<ConversionContext, "parentUuid">,
  responses?: Map<
    string,
    {
      approved: boolean;
      mode?:
        | "default"
        | "acceptEdits"
        | "bypassPermissions"
        | "plan"
        | "dontAsk"
        | "auto";
      reason?: string;
    }
  >,
): RawJSONLines | null {
  const converter = new ClaudeJsonlToLogConverter(context, responses);
  return converter.convert(jsonlMessage);
}
