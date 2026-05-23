/**
 * Extracts structured timeline events from SDK messages and reports them
 * to the server via apiMachine.sessionEvent(). Fire-and-forget.
 *
 * Currently supports Claude Code messages only.
 * Events: file_edit, bash_command, tool_call, git_operation, error
 */

import type { ClaudeJsonlMessage, ClaudeJsonlAssistantMessage } from "./jsonl";
import { logger } from "@/ui/logger";

export interface SessionEventSink {
  sessionEvent(
    sessionId: string,
    eventType: string,
    summary: string,
    detail?: Record<string, unknown>,
  ): void;
}

const GIT_COMMANDS = ["git commit", "git push", "git pull", "git checkout", "git merge", "git rebase", "git stash"];

function isGitCommand(input: string): boolean {
  return GIT_COMMANDS.some((cmd) => input.startsWith(cmd));
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/**
 * Create a reporter function that can be called from onMessage.
 * getSessionId is called lazily on each message so it works even when
 * the session ID is not yet known at reporter creation time.
 */
export function createSessionEventReporter(
  sink: SessionEventSink,
  getSessionId: () => string | null | undefined,
) {
  return function reportMessage(message: ClaudeJsonlMessage): void {
    const sessionId = getSessionId();
    if (!sessionId) return;
    try {
      if (message.type !== "assistant") return;

      const aMsg = message as ClaudeJsonlAssistantMessage;
      const content = aMsg.message?.content;
      if (!Array.isArray(content)) return;

      for (const block of content) {
        if (block.type !== "tool_use") continue;

        const input = block.input as Record<string, unknown>;
        const toolName = block.name;

        // File edit: Write or Edit tool
        if (toolName === "Write" || toolName === "Edit") {
          const filePath = typeof input?.file_path === "string" ? input.file_path : "unknown";
          const action = toolName === "Write" ? "Created" : "Edited";
          sink.sessionEvent(sessionId, "file_edit", `${action} ${truncate(filePath, 100)}`, {
            tool: toolName,
            filePath,
          });
          continue;
        }

        // Bash command
        if (toolName === "Bash") {
          const command = typeof input?.command === "string" ? input.command : "";
          if (!command) continue;

          // Check if it's a git operation
          if (isGitCommand(command.trim())) {
            sink.sessionEvent(sessionId, "git_operation", `${truncate(command.trim(), 120)}`, {
              command: truncate(command, 500),
            });
          } else {
            sink.sessionEvent(sessionId, "bash_command", `$ ${truncate(command.trim(), 120)}`, {
              command: truncate(command, 500),
            });
          }
          continue;
        }

        // Other tool calls (Read, Grep, Glob, Agent, etc.)
        sink.sessionEvent(sessionId, "tool_call", `${toolName}`, {
          tool: toolName,
          input: Object.fromEntries(
            Object.entries(input)
              .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
              .map(([k, v]) => [k, typeof v === "string" ? truncate(v as string, 200) : v]),
          ),
        });
      }
    } catch (err) {
      logger.debug(`[timeline] Error reporting session event: ${err}`);
    }
  };
}
