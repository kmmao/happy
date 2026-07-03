/**
 * Tool-call tracker — the pure "match a canCallTool invocation to its JSONL
 * tool_use id" seam lifted out of `PermissionHandler`.
 *
 * The SDK's `canCallTool` callback hands the handler a `(toolName, input)` pair
 * but NOT the tool_use id the App needs to address a permission request. The id
 * only appears in the JSONL stream. This tracker ingests the stream, remembers
 * each `tool_use` block, and resolves a later `(name, input)` back to its id by
 * a deep-equal match on the most recent UNUSED call — marking it used so a
 * repeated identical call resolves to the next occurrence, not the same one.
 *
 * This deep-equal-most-recent-unused logic is exactly the kind of subtle
 * matching that breaks silently (wrong id → permission request sent for the
 * wrong call, or a hang). Isolating it here — in-process pure, no Session
 * coupling — gives it a real test surface.
 */

import { isDeepStrictEqual } from "node:util";
import type {
  ClaudeJsonlMessage,
  ClaudeJsonlAssistantMessage,
  ClaudeJsonlUserMessage,
} from "../jsonl";

type TrackedToolCall = {
  id: string;
  name: string;
  input: unknown;
  used: boolean;
};

const EXIT_PLAN_NAMES: ReadonlySet<string> = new Set([
  "exit_plan_mode",
  "ExitPlanMode",
]);

export type ToolCallTracker = {
  /** Ingest one JSONL record: remember assistant tool_use blocks, retire calls whose tool_result arrived. */
  ingest(message: ClaudeJsonlMessage): void;
  /**
   * Resolve `(name, input)` to the id of the most recent unused matching call,
   * marking it used. Returns null when no unused match exists.
   */
  resolveId(name: string, input: unknown): string | null;
  /** Mark a specific call used by id (used by the ExitPlanMode auto-approve path). */
  markUsed(id: string): void;
  /** True when the call with this id is an ExitPlanMode invocation (always aborted). */
  isExitPlanCall(id: string): boolean;
  /** Forget every tracked call (session reset). */
  clear(): void;
};

export function createToolCallTracker(): ToolCallTracker {
  let toolCalls: TrackedToolCall[] = [];

  return {
    ingest(message: ClaudeJsonlMessage): void {
      if (message.type === "assistant") {
        const assistantMsg = message as ClaudeJsonlAssistantMessage;
        if (assistantMsg.message?.content) {
          for (const block of assistantMsg.message.content) {
            if (block.type === "tool_use") {
              toolCalls.push({
                id: block.id!,
                name: block.name!,
                input: block.input,
                used: false,
              });
            }
          }
        }
        return;
      }
      if (message.type === "user") {
        const userMsg = message as ClaudeJsonlUserMessage;
        if (Array.isArray(userMsg.message?.content)) {
          for (const block of userMsg.message.content) {
            if (block.type === "tool_result" && block.tool_use_id) {
              const toolCall = toolCalls.find(
                (tc) => tc.id === block.tool_use_id,
              );
              if (toolCall && !toolCall.used) {
                toolCall.used = true;
              }
            }
          }
        }
      }
    },

    resolveId(name: string, input: unknown): string | null {
      // Search in reverse (most recent first).
      for (let i = toolCalls.length - 1; i >= 0; i--) {
        const call = toolCalls[i];
        if (call.name === name && isDeepStrictEqual(call.input, input)) {
          if (call.used) {
            return null;
          }
          call.used = true;
          return call.id;
        }
      }
      return null;
    },

    markUsed(id: string): void {
      const toolCall = toolCalls.find((tc) => tc.id === id);
      if (toolCall) {
        toolCall.used = true;
      }
    },

    isExitPlanCall(id: string): boolean {
      const toolCall = toolCalls.find((tc) => tc.id === id);
      return !!toolCall && EXIT_PLAN_NAMES.has(toolCall.name);
    },

    clear(): void {
      toolCalls = [];
    },
  };
}
