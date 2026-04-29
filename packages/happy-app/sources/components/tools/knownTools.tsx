import { Metadata } from "@/sync/storageTypes";
import { ToolCall, Message } from "@/sync/typesMessage";
import { resolvePath } from "@/utils/pathUtils";
import * as z from "zod";
import { Ionicons, Octicons } from "@expo/vector-icons";
import {
  getHappyMcpToolAction as getSharedHappyMcpToolAction,
  getHappyMcpToolTitle as getSharedHappyMcpToolTitle,
} from "@kmmao/happy-wire";
import React from "react";
import { t } from "@/text";
import { getDiffStatsLight } from "@/components/diff/calculateDiff";
import { trimIdent } from "@/utils/trimIdent";
import {
  getCodexCommandPreview,
  getCodexParsedCommandSummary,
} from "./codexCommandUtils";
import {
  formatCodexBashDescription,
  formatCodexBashTitle,
} from "./codexBashPresentation";
import { getCodexDiffStats, parseCodexUnifiedDiff } from "./codexDiffUtils";
import { getCodexPatchEntries, getCodexPatchTotals } from "./codexPatchUtils";
import { formatMCPTitle } from "./views/MCPToolView";

// Icon factory functions
const ICON_TERMINAL = (size: number = 24, color: string = "#000") => (
  <Octicons name="terminal" size={size} color={color} />
);
const ICON_SEARCH = (size: number = 24, color: string = "#000") => (
  <Octicons name="search" size={size} color={color} />
);
const ICON_READ = (size: number = 24, color: string = "#000") => (
  <Octicons name="eye" size={size} color={color} />
);
const ICON_EDIT = (size: number = 24, color: string = "#000") => (
  <Octicons name="file-diff" size={size} color={color} />
);
const ICON_WEB = (size: number = 24, color: string = "#000") => (
  <Ionicons name="globe-outline" size={size} color={color} />
);
const ICON_EXIT = (size: number = 24, color: string = "#000") => (
  <Ionicons name="exit-outline" size={size} color={color} />
);
const ICON_TODO = (size: number = 24, color: string = "#000") => (
  <Ionicons name="bulb-outline" size={size} color={color} />
);
const ICON_REASONING = (size: number = 24, color: string = "#000") => (
  <Octicons name="light-bulb" size={size} color={color} />
);
const ICON_QUESTION = (size: number = 24, color: string = "#000") => (
  <Ionicons name="help-circle-outline" size={size} color={color} />
);
const ICON_PUZZLE = (size: number = 24, color: string = "#000") => (
  <Ionicons name="extension-puzzle-outline" size={size} color={color} />
);

/**
 * Extract a short display name from a file path.
 * For project-relative paths (already resolved by resolvePath), returns as-is.
 * For absolute paths (temp dirs, uploads, etc.), returns the basename.
 */
function extractDisplayName(path: string): string {
  // Already a short relative path — keep it
  if (!path.startsWith("/") && !path.startsWith("\\")) {
    return path;
  }
  // Absolute path: show only the filename
  const basename = path.split("/").pop() || path;
  return basename;
}

/** Resolve a file path and extract its display name in one step. */
function resolveAndDisplay(filePath: string, metadata: Metadata | null): string {
    return extractDisplayName(resolvePath(filePath, metadata));
}

function resolveFileSummary(
  filePath: string,
  metadata: Metadata | null,
): { displayName: string; resolvedPath: string } {
  const resolvedPath = resolvePath(filePath, metadata);
  const displayName = resolvedPath.split("/").pop() || resolvedPath;
  return { displayName, resolvedPath };
}

function resolveFileSubtitle(
  filePath: string,
  metadata: Metadata | null,
): string | null {
  const { displayName, resolvedPath } = resolveFileSummary(filePath, metadata);
  return displayName === resolvedPath ? null : resolvedPath;
}

function getTrimmedDiffStats(
  oldText: string,
  newText: string,
): { additions: number; deletions: number } | null {
  const stats = getDiffStatsLight(trimIdent(oldText), trimIdent(newText));
  if (stats.additions === 0 && stats.deletions === 0) {
    return null;
  }
  return stats;
}

function extractGeminiEditPayload(input: any): {
  oldText: string;
  newText: string;
  path: string | null;
} {
  if (input?.toolCall?.content?.[0]) {
    const content = input.toolCall.content[0];
    return {
      oldText: content.oldText ?? "",
      newText: content.newText ?? "",
      path: typeof content.path === "string" ? content.path : null,
    };
  }

  if (Array.isArray(input?.input) && input.input[0]) {
    const content = input.input[0];
    return {
      oldText: content.oldText ?? "",
      newText: content.newText ?? "",
      path: typeof content.path === "string" ? content.path : null,
    };
  }

  return {
    oldText: input?.oldText ?? input?.old_string ?? "",
    newText: input?.newText ?? input?.new_string ?? "",
    path:
      typeof input?.path === "string"
        ? input.path
        : typeof input?.file_path === "string"
          ? input.file_path
          : null,
  };
}

function formatHappyMcpToolTitle(toolName: string): string {
  const sharedTitle = getSharedHappyMcpToolTitle(toolName);
  if (sharedTitle) {
    return sharedTitle;
  }
  const normalized = toolName.trim();
  if (
    normalized === "save_memory" ||
    normalized === "happy__save_memory" ||
    normalized === "mcp__happy__save_memory"
  ) {
    return "Save Memory";
  }
  return normalized.startsWith("mcp__")
    ? formatMCPTitle(normalized)
    : normalized;
}

function formatHappyMcpToolAction(
  toolName: string,
  mode: "dynamic" | "permission" | "fallback",
): string {
  const sharedAction = getSharedHappyMcpToolAction(toolName, mode);
  if (sharedAction) {
    return sharedAction;
  }
  const normalized = toolName.trim();
  if (
    normalized === "save_memory" ||
    normalized === "happy__save_memory" ||
    normalized === "mcp__happy__save_memory"
  ) {
    return mode === "permission"
      ? "Waiting for approval to save memory"
      : mode === "dynamic"
        ? "Saving memory"
        : "Save memory";
  }
  return mode === "permission" ? "Permission request" : "Tool call";
}

export const sessionCompactToolNames = new Set([
  "NotebookEdit",
  "edit",
  "CodexPatch",
  "GeminiPatch",
  "CodexDiff",
  "GeminiDiff",
]);

const editToolInputSchema = z
  .object({
    file_path: z
      .string()
      .describe("The absolute path to the file to modify"),
    old_string: z.string().describe("The text to replace"),
    new_string: z.string().describe("The text to replace it with"),
    replace_all: z
      .boolean()
      .optional()
      .default(false)
      .describe("Replace all occurrences"),
  })
  .partial()
  .passthrough();

// Shared definition for Task/Agent tool (SDK renamed Task → Agent)
const taskToolDef = {
  title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
    const subagentType =
      typeof opts.tool.input?.subagent_type === "string"
        ? opts.tool.input.subagent_type
        : null;
    const desc =
      typeof opts.tool.input?.description === "string"
        ? opts.tool.input.description
        : null;
    if (subagentType && desc) {
      return `${subagentType} · ${desc}`;
    }
    if (desc) return desc;
    if (subagentType) return subagentType;
    return t("tools.names.task");
  },
  icon: (size: number = 24, color: string = "#000") => (
    <Octicons name="copilot" size={size} color={color} />
  ),
  minimal: (opts: {
    metadata: Metadata | null;
    tool: ToolCall;
    messages?: Message[];
  }) => {
    // Check if there would be any filtered tasks
    const messages = opts.messages || [];
    for (let m of messages) {
      if (
        m.kind === "tool-call" &&
        (m.tool.state === "running" ||
          m.tool.state === "completed" ||
          m.tool.state === "error")
      ) {
        return false; // Has active sub-tasks, show expanded
      }
    }
    return true; // No active sub-tasks, render as minimal
  },
  input: z
    .object({
      prompt: z.string().describe("The task for the agent to perform"),
      subagent_type: z
        .string()
        .optional()
        .describe("The type of specialized agent to use"),
    })
    .partial()
    .passthrough(),
};

export const knownTools = {
  Task: taskToolDef,
  Agent: taskToolDef,
  Bash: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (opts.tool.description) {
        return opts.tool.description;
      }
      return t("tools.names.terminal");
    },
    icon: ICON_TERMINAL,
    minimal: true,
    hideDefaultError: true,
    isMutable: true,
    input: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z
        .number()
        .optional()
        .describe("Timeout in milliseconds (max 600000)"),
    }),
    result: z
      .object({
        stderr: z.string(),
        stdout: z.string(),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (typeof opts.tool.input.command === "string") {
        return t("tools.desc.terminalCmd", { cmd: opts.tool.input.command });
      }
      return t("tools.names.terminal");
    },
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.command === "string") {
        return opts.tool.input.command;
      }
      return null;
    },
  },
  Glob: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.pattern === "string") {
        return opts.tool.input.pattern;
      }
      return t("tools.names.searchFiles");
    },
    icon: ICON_SEARCH,
    minimal: true,
    input: z
      .object({
        pattern: z.string().describe("The glob pattern to match files against"),
        path: z.string().optional().describe("The directory to search in"),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (typeof opts.tool.input.pattern === "string") {
        return t("tools.desc.searchPattern", {
          pattern: opts.tool.input.pattern,
        });
      }
      return t("tools.names.search");
    },
  },
  Grep: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.pattern === "string") {
        return `grep(pattern: ${opts.tool.input.pattern})`;
      }
      return "Search Content";
    },
    icon: ICON_READ,
    minimal: true,
    input: z
      .object({
        pattern: z
          .string()
          .describe("The regular expression pattern to search for"),
        path: z.string().optional().describe("File or directory to search in"),
        output_mode: z
          .enum(["content", "files_with_matches", "count"])
          .optional(),
        "-n": z.boolean().optional().describe("Show line numbers"),
        "-i": z.boolean().optional().describe("Case insensitive search"),
        "-A": z.number().optional().describe("Lines to show after match"),
        "-B": z.number().optional().describe("Lines to show before match"),
        "-C": z
          .number()
          .optional()
          .describe("Lines to show before and after match"),
        glob: z.string().optional().describe("Glob pattern to filter files"),
        type: z.string().optional().describe("File type to search"),
        head_limit: z
          .number()
          .optional()
          .describe("Limit output to first N lines/entries"),
        multiline: z.boolean().optional().describe("Enable multiline mode"),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (typeof opts.tool.input.pattern === "string") {
        return `Search(pattern: ${opts.tool.input.pattern})`;
      }
      return "Search";
    },
  },
  LS: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.path === "string") {
        return resolvePath(opts.tool.input.path, opts.metadata);
      }
      return t("tools.names.listFiles");
    },
    icon: ICON_SEARCH,
    minimal: true,
    input: z
      .object({
        path: z.string().describe("The absolute path to the directory to list"),
        ignore: z
          .array(z.string())
          .optional()
          .describe("List of glob patterns to ignore"),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (typeof opts.tool.input.path === "string") {
        const path = resolvePath(opts.tool.input.path, opts.metadata);
        const basename = path.split("/").pop() || path;
        return t("tools.desc.searchPath", { basename });
      }
      return t("tools.names.search");
    },
  },
  ExitPlanMode: {
    title: t("tools.names.planProposal"),
    icon: ICON_EXIT,
    input: z
      .object({
        plan: z.string().describe("The plan you came up with"),
      })
      .partial()
      .passthrough(),
  },
  exit_plan_mode: {
    title: t("tools.names.planProposal"),
    icon: ICON_EXIT,
    input: z
      .object({
        plan: z.string().describe("The plan you came up with"),
      })
      .partial()
      .passthrough(),
  },
  Read: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.file_path === "string") {
        return resolveAndDisplay(opts.tool.input.file_path, opts.metadata);
      }
      // Gemini uses 'locations' array with 'path' field
      if (
        opts.tool.input.locations &&
        Array.isArray(opts.tool.input.locations) &&
        opts.tool.input.locations[0]?.path
      ) {
        return resolveAndDisplay(opts.tool.input.locations[0].path, opts.metadata);
      }
      return t("tools.names.readFile");
    },
    minimal: true,
    icon: ICON_READ,
    input: z
      .object({
        file_path: z.string().describe("The absolute path to the file to read"),
        limit: z.number().optional().describe("The number of lines to read"),
        offset: z
          .number()
          .optional()
          .describe("The line number to start reading from"),
        // Gemini format
        items: z.array(z.any()).optional(),
        locations: z
          .array(z.object({ path: z.string() }).passthrough())
          .optional(),
      })
      .partial()
      .passthrough(),
    result: z
      .object({
        file: z
          .object({
            filePath: z
              .string()
              .describe("The absolute path to the file to read"),
            content: z.string().describe("The content of the file"),
            numLines: z.number().describe("The number of lines in the file"),
            startLine: z
              .number()
              .describe("The line number to start reading from"),
            totalLines: z
              .number()
              .describe("The total number of lines in the file"),
          })
          .passthrough()
          .optional(),
      })
      .partial()
      .passthrough(),
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const filePath =
        typeof opts.tool.input.file_path === "string"
          ? opts.tool.input.file_path
          : opts.tool.input.locations?.[0]?.path;
      if (typeof filePath === "string") {
        const resolved = resolvePath(filePath, opts.metadata);
        const displayName = extractDisplayName(resolved);
        // Only show subtitle if the title was shortened
        if (displayName !== resolved) {
          return resolved;
        }
      }
      return null;
    },
  },
  // Gemini uses lowercase 'read'
  read: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      // Gemini uses 'locations' array with 'path' field
      if (
        opts.tool.input.locations &&
        Array.isArray(opts.tool.input.locations) &&
        opts.tool.input.locations[0]?.path
      ) {
        return resolveAndDisplay(opts.tool.input.locations[0].path, opts.metadata);
      }
      if (typeof opts.tool.input.file_path === "string") {
        return resolveAndDisplay(opts.tool.input.file_path, opts.metadata);
      }
      return t("tools.names.readFile");
    },
    minimal: true,
    icon: ICON_READ,
    input: z
      .object({
        items: z.array(z.any()).optional(),
        locations: z
          .array(z.object({ path: z.string() }).passthrough())
          .optional(),
        file_path: z.string().optional(),
      })
      .partial()
      .passthrough(),
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const filePath =
        opts.tool.input.locations?.[0]?.path ??
        (typeof opts.tool.input.file_path === "string"
          ? opts.tool.input.file_path
          : undefined);
      if (typeof filePath === "string") {
        const resolved = resolvePath(filePath, opts.metadata);
        const displayName = extractDisplayName(resolved);
        if (displayName !== resolved) {
          return resolved;
        }
      }
      return null;
    },
  },
  Edit: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.file_path === "string") {
        return resolveFileSummary(
          opts.tool.input.file_path,
          opts.metadata,
        ).displayName;
      }
      return t("tools.names.editFile");
    },
    icon: ICON_EDIT,
    isMutable: true,
    input: editToolInputSchema,
    extractStats: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const parsed = editToolInputSchema.safeParse(opts.tool.input);
      if (!parsed.success) return null;
      return getTrimmedDiffStats(
        parsed.data.old_string || "",
        parsed.data.new_string || "",
      );
    },
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.file_path === "string") {
        return resolveFileSubtitle(opts.tool.input.file_path, opts.metadata);
      }
      return null;
    },
  },
  MultiEdit: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.file_path === "string") {
        const { displayName } = resolveFileSummary(
          opts.tool.input.file_path,
          opts.metadata,
        );
        const editCount = Array.isArray(opts.tool.input.edits)
          ? opts.tool.input.edits.length
          : 0;
        if (editCount > 1) {
          return t("tools.desc.multiEditEdits", {
            path: displayName,
            count: editCount,
          });
        }
        return displayName;
      }
      return t("tools.names.editFile");
    },
    icon: ICON_EDIT,
    isMutable: true,
    input: z
      .object({
        file_path: z
          .string()
          .describe("The absolute path to the file to modify"),
        edits: z
          .array(
            z.object({
              old_string: z.string().describe("The text to replace"),
              new_string: z.string().describe("The text to replace it with"),
              replace_all: z
                .boolean()
                .optional()
                .default(false)
                .describe("Replace all occurrences"),
            }),
          )
          .describe("Array of edit operations"),
      })
      .partial()
      .passthrough(),
    extractStats: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const parsed = knownTools.MultiEdit.input.safeParse(opts.tool.input);
      if (!parsed.success || !parsed.data.edits) return null;
      let totalAdditions = 0;
      let totalDeletions = 0;
      for (const edit of parsed.data.edits) {
        const stats = getTrimmedDiffStats(
          edit.old_string || "",
          edit.new_string || "",
        );
        if (!stats) continue;
        totalAdditions += stats.additions;
        totalDeletions += stats.deletions;
      }
      if (totalAdditions === 0 && totalDeletions === 0) return null;
      return { additions: totalAdditions, deletions: totalDeletions };
    },
    extractStatus: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.file_path === "string") {
        const { displayName } = resolveFileSummary(
          opts.tool.input.file_path,
          opts.metadata,
        );
        const editCount = Array.isArray(opts.tool.input.edits)
          ? opts.tool.input.edits.length
          : 0;
        if (editCount > 0) {
          return t("tools.desc.multiEditEdits", {
            path: displayName,
            count: editCount,
          });
        }
        return displayName;
      }
      return null;
    },
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.file_path === "string") {
        return resolveFileSubtitle(opts.tool.input.file_path, opts.metadata);
      }
      return null;
    },
  },
  Write: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.file_path === "string") {
        return resolveFileSummary(
          opts.tool.input.file_path,
          opts.metadata,
        ).displayName;
      }
      return t("tools.names.writeFile");
    },
    icon: ICON_EDIT,
    isMutable: true,
    input: z
      .object({
        file_path: z
          .string()
          .describe("The absolute path to the file to write"),
        content: z.string().describe("The content to write to the file"),
      })
      .partial()
      .passthrough(),
    extractStats: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }): { additions: number; deletions: number } | null => {
      const content =
        typeof opts.tool.input?.content === "string"
          ? opts.tool.input.content
          : "";
      if (!content) return null;
      const lineCount: number = content.split("\n").filter(Boolean).length;
      if (lineCount === 0) return null;
      return { additions: lineCount, deletions: 0 };
    },
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.file_path === "string") {
        return resolveFileSubtitle(opts.tool.input.file_path, opts.metadata);
      }
      return null;
    },
  },
  WebFetch: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.url === "string") {
        try {
          const url = new URL(opts.tool.input.url);
          return url.hostname;
        } catch {
          return t("tools.names.fetchUrl");
        }
      }
      return t("tools.names.fetchUrl");
    },
    icon: ICON_WEB,
    minimal: true,
    input: z
      .object({
        url: z.string().url().describe("The URL to fetch content from"),
        prompt: z.string().describe("The prompt to run on the fetched content"),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (typeof opts.tool.input.url === "string") {
        try {
          const url = new URL(opts.tool.input.url);
          return t("tools.desc.fetchUrlHost", { host: url.hostname });
        } catch {
          return t("tools.names.fetchUrl");
        }
      }
      return "Fetch URL";
    },
  },
  NotebookRead: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.notebook_path === "string") {
        const path = resolvePath(opts.tool.input.notebook_path, opts.metadata);
        return path;
      }
      return t("tools.names.readNotebook");
    },
    icon: ICON_READ,
    minimal: true,
    input: z
      .object({
        notebook_path: z
          .string()
          .describe("The absolute path to the Jupyter notebook file"),
        cell_id: z
          .string()
          .optional()
          .describe("The ID of a specific cell to read"),
      })
      .partial()
      .passthrough(),
  },
  NotebookEdit: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.notebook_path === "string") {
        return resolveFileSummary(
          opts.tool.input.notebook_path,
          opts.metadata,
        ).displayName;
      }
      return t("tools.names.editNotebook");
    },
    icon: ICON_EDIT,
    isMutable: true,
    input: z
      .object({
        notebook_path: z
          .string()
          .describe("The absolute path to the notebook file"),
        new_source: z.string().describe("The new source for the cell"),
        cell_id: z.string().optional().describe("The ID of the cell to edit"),
        cell_type: z
          .enum(["code", "markdown"])
          .optional()
          .describe("The type of the cell"),
        edit_mode: z
          .enum(["replace", "insert", "delete"])
          .optional()
          .describe("The type of edit to make"),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (typeof opts.tool.input.notebook_path === "string") {
        const path = resolvePath(opts.tool.input.notebook_path, opts.metadata);
        const mode = opts.tool.input.edit_mode || "replace";
        return t("tools.desc.editNotebookMode", { path, mode });
      }
      return t("tools.names.editNotebook");
    },
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.notebook_path === "string") {
        return resolveFileSubtitle(opts.tool.input.notebook_path, opts.metadata);
      }
      return null;
    },
  },
  TodoWrite: {
    title: t("tools.names.todoList"),
    icon: ICON_TODO,
    noStatus: true,
    minimal: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
      messages?: Message[];
    }) => {
      // Check if there are todos in the input
      if (
        opts.tool.input?.todos &&
        Array.isArray(opts.tool.input.todos) &&
        opts.tool.input.todos.length > 0
      ) {
        return false; // Has todos, show expanded
      }

      // Check if there are todos in the result
      if (
        opts.tool.result?.newTodos &&
        Array.isArray(opts.tool.result.newTodos) &&
        opts.tool.result.newTodos.length > 0
      ) {
        return false; // Has todos, show expanded
      }

      return true; // No todos, render as minimal
    },
    input: z
      .object({
        todos: z
          .array(
            z
              .object({
                content: z.string().describe("The todo item content"),
                status: z
                  .enum(["pending", "in_progress", "completed"])
                  .describe("The status of the todo"),
                priority: z
                  .enum(["high", "medium", "low"])
                  .optional()
                  .describe("The priority of the todo"),
                id: z
                  .string()
                  .optional()
                  .describe("Unique identifier for the todo"),
              })
              .passthrough(),
          )
          .describe("The updated todo list"),
      })
      .partial()
      .passthrough(),
    result: z
      .object({
        oldTodos: z
          .array(
            z
              .object({
                content: z.string().describe("The todo item content"),
                status: z
                  .enum(["pending", "in_progress", "completed"])
                  .describe("The status of the todo"),
                priority: z
                  .enum(["high", "medium", "low"])
                  .optional()
                  .describe("The priority of the todo"),
                id: z.string().describe("Unique identifier for the todo"),
              })
              .passthrough(),
          )
          .describe("The old todo list"),
        newTodos: z
          .array(
            z
              .object({
                content: z.string().describe("The todo item content"),
                status: z
                  .enum(["pending", "in_progress", "completed"])
                  .describe("The status of the todo"),
                priority: z
                  .enum(["high", "medium", "low"])
                  .optional()
                  .describe("The priority of the todo"),
                id: z.string().describe("Unique identifier for the todo"),
              })
              .passthrough(),
          )
          .describe("The new todo list"),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (Array.isArray(opts.tool.input.todos)) {
        const count = opts.tool.input.todos.length;
        return t("tools.desc.todoListCount", { count });
      }
      return t("tools.names.todoList");
    },
  },
  WebSearch: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (typeof opts.tool.input.query === "string") {
        return opts.tool.input.query;
      }
      return t("tools.names.webSearch");
    },
    icon: ICON_WEB,
    minimal: true,
    input: z
      .object({
        query: z.string().min(2).describe("The search query to use"),
        allowed_domains: z
          .array(z.string())
          .optional()
          .describe("Only include results from these domains"),
        blocked_domains: z
          .array(z.string())
          .optional()
          .describe("Never include results from these domains"),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (typeof opts.tool.input.query === "string") {
        return t("tools.desc.webSearchQuery", { query: opts.tool.input.query });
      }
      return t("tools.names.webSearch");
    },
  },
  CodexBash: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const summary = getCodexParsedCommandSummary(
        opts.tool.input,
        opts.metadata,
      );
      const semanticTitle = formatCodexBashTitle(summary);
      if (semanticTitle) {
        return semanticTitle;
      }
      return t("tools.names.terminal");
    },
    icon: ICON_TERMINAL,
    minimal: true,
    hideDefaultError: true,
    isMutable: true,
    input: z
      .object({
        command: z
          .union([z.string(), z.array(z.string())])
          .describe("The command to execute"),
        cwd: z.string().optional().describe("Current working directory"),
        parsed_cmd: z
          .array(
            z
              .object({
                type: z
                  .string()
                  .describe("Type of parsed command (read, write, bash, etc.)"),
                cmd: z.string().optional().describe("The command string"),
                name: z
                  .string()
                  .optional()
                  .describe("File name or resource name"),
              })
              .passthrough(),
          )
          .optional()
          .describe("Parsed command information"),
      })
      .partial()
      .passthrough(),
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const summary = getCodexParsedCommandSummary(
        opts.tool.input,
        opts.metadata,
      );
      if (summary) {
        if (
          (summary.type === "read" || summary.type === "write") &&
          summary.resolvedPath
        ) {
          return summary.resolvedPath;
        }
        if (summary.type === "search" && summary.query) {
          return summary.query;
        }
        if (summary.type === "list_files" && summary.resolvedPath) {
          return summary.resolvedPath;
        }
        if (summary.workspace) {
          return summary.workspace;
        }
        if (summary.command) {
          return summary.command;
        }
      }
      const commandPreview = getCodexCommandPreview(opts.tool.input?.command, 160);
      if (commandPreview) {
        return commandPreview;
      }
      return null;
    },
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      const summary = getCodexParsedCommandSummary(
        opts.tool.input,
        opts.metadata,
      );
      const semanticDescription = formatCodexBashDescription(summary);
      if (semanticDescription) {
        return semanticDescription;
      }
      return t("tools.names.terminal");
    },
  },
  CodexReasoning: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      // Use the title from input if provided
      if (opts.tool.input?.title && typeof opts.tool.input.title === "string") {
        return opts.tool.input.title;
      }
      return t("tools.names.reasoning");
    },
    icon: ICON_REASONING,
    minimal: true,
    input: z
      .object({
        title: z.string().describe("The title of the reasoning"),
      })
      .partial()
      .passthrough(),
    result: z
      .object({
        content: z.string().describe("The reasoning content"),
        status: z
          .enum(["completed", "in_progress", "error"])
          .optional()
          .describe("The status of the reasoning"),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (opts.tool.input?.title && typeof opts.tool.input.title === "string") {
        return opts.tool.input.title;
      }
      return t("tools.names.reasoning");
    },
  },
  GeminiReasoning: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      // Use the title from input if provided
      if (opts.tool.input?.title && typeof opts.tool.input.title === "string") {
        return opts.tool.input.title;
      }
      return t("tools.names.reasoning");
    },
    icon: ICON_REASONING,
    minimal: true,
    input: z
      .object({
        title: z.string().describe("The title of the reasoning"),
      })
      .partial()
      .passthrough(),
    result: z
      .object({
        content: z.string().describe("The reasoning content"),
        status: z
          .enum(["completed", "in_progress", "canceled"])
          .optional()
          .describe("The status of the reasoning"),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (opts.tool.input?.title && typeof opts.tool.input.title === "string") {
        return opts.tool.input.title;
      }
      return t("tools.names.reasoning");
    },
  },
  think: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      // Use the title from input if provided
      if (opts.tool.input?.title && typeof opts.tool.input.title === "string") {
        return opts.tool.input.title;
      }
      return t("tools.names.reasoning");
    },
    icon: ICON_REASONING,
    minimal: true,
    input: z
      .object({
        title: z.string().optional().describe("The title of the thinking"),
        items: z.array(z.any()).optional().describe("Items to think about"),
        locations: z
          .array(z.any())
          .optional()
          .describe("Locations to consider"),
      })
      .partial()
      .passthrough(),
    result: z
      .object({
        content: z.string().optional().describe("The reasoning content"),
        text: z.string().optional().describe("The reasoning text"),
        status: z
          .enum(["completed", "in_progress", "canceled"])
          .optional()
          .describe("The status"),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (opts.tool.input?.title && typeof opts.tool.input.title === "string") {
        return opts.tool.input.title;
      }
      return t("tools.names.reasoning");
    },
  },
  change_title: {
    title: "Change Title",
    icon: ICON_EDIT,
    minimal: true,
    noStatus: true,
    input: z
      .object({
        title: z.string().optional().describe("New session title"),
      })
      .partial()
      .passthrough(),
    result: z.object({}).partial().passthrough(),
  },
  mcp__happy__change_title: {
    title: "Change Title",
    icon: ICON_EDIT,
    minimal: true,
    noStatus: true,
    input: z
      .object({
        title: z.string().optional().describe("New session title"),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (typeof opts.tool.input?.title === "string" && opts.tool.input.title) {
        return opts.tool.input.title;
      }
      return "Update chat title";
    },
  },
  mcp__happy__query_project_knowledge: {
    title: formatHappyMcpToolTitle("mcp__happy__query_project_knowledge"),
    icon: ICON_READ,
    minimal: true,
    noStatus: true,
    input: z
      .object({
        query: z.string().optional().describe("Knowledge query"),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (typeof opts.tool.input?.query === "string" && opts.tool.input.query) {
        return opts.tool.input.query;
      }
      return "Search project knowledge";
    },
  },
  mcp__happy__update_progress: {
    title: formatHappyMcpToolTitle("mcp__happy__update_progress"),
    icon: ICON_TODO,
    minimal: false,
    noStatus: true,
    input: z.object({}).partial().passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (Array.isArray(opts.tool.input?.todos)) {
        return `Update checklist (${opts.tool.input.todos.length} items)`;
      }
      return formatHappyMcpToolAction(
        "mcp__happy__update_progress",
        "fallback",
      );
    },
    extractSubtitle: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (
        typeof opts.tool.input?.currentStage === "string" &&
        opts.tool.input.currentStage.trim().length > 0
      ) {
        return opts.tool.input.currentStage.trim();
      }
      if (
        typeof opts.tool.input?.label === "string" &&
        opts.tool.input.label.trim().length > 0
      ) {
        return opts.tool.input.label.trim();
      }
      return null;
    },
  },
  mcp__happy__update_session_summary: {
    title: formatHappyMcpToolTitle("mcp__happy__update_session_summary"),
    icon: ICON_EDIT,
    minimal: true,
    noStatus: true,
    input: z.object({}).partial().passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      if (typeof opts.tool.input?.goal === "string" && opts.tool.input.goal) {
        return opts.tool.input.goal;
      }
      return formatHappyMcpToolAction(
        "mcp__happy__update_session_summary",
        "fallback",
      );
    },
  },
  mcp__happy__save_memory: {
    title: "Save Memory",
    icon: ICON_TODO,
    minimal: true,
    noStatus: true,
    input: z.object({}).partial().passthrough(),
    extractDescription: () => "Save memory",
  },
  CodexDynamicTool: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const requestedToolName =
        typeof opts.tool.input?.requestedToolName === "string"
          ? opts.tool.input.requestedToolName
          : typeof opts.tool.input?.toolName === "string"
            ? opts.tool.input.toolName
            : null;
      if (requestedToolName) {
        return formatHappyMcpToolTitle(requestedToolName);
      }
      return "Dynamic Tool";
    },
    icon: ICON_PUZZLE,
    minimal: true,
    noStatus: true,
    input: z.object({}).partial().passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      const requestedToolName =
        typeof opts.tool.input?.requestedToolName === "string"
          ? opts.tool.input.requestedToolName
          : typeof opts.tool.input?.toolName === "string"
            ? opts.tool.input.toolName
            : null;
      if (requestedToolName) {
        if (
          requestedToolName === "mcp__happy__change_title" &&
          typeof opts.tool.input?.title === "string" &&
          opts.tool.input.title
        ) {
          return opts.tool.input.title;
        }
        if (
          requestedToolName === "mcp__happy__query_project_knowledge" &&
          typeof opts.tool.input?.query === "string" &&
          opts.tool.input.query
        ) {
          return opts.tool.input.query;
        }
        return formatHappyMcpToolAction(requestedToolName, "dynamic");
      }
      return "Dynamic tool call";
    },
  },
  CodexPermissions: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const requestedToolName =
        typeof opts.tool.input?.requestedToolName === "string"
          ? opts.tool.input.requestedToolName
          : null;
      if (requestedToolName) {
        return formatHappyMcpToolTitle(requestedToolName);
      }
      return "Permission Request";
    },
    icon: ICON_QUESTION,
    minimal: true,
    noStatus: true,
    input: z.object({}).partial().passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      const requestedToolName =
        typeof opts.tool.input?.requestedToolName === "string"
          ? opts.tool.input.requestedToolName
          : null;
      if (requestedToolName) {
        const reason =
          typeof opts.tool.input?.reason === "string" ? opts.tool.input.reason : null;
        return reason || formatHappyMcpToolAction(requestedToolName, "permission");
      }
      return "Permission request";
    },
  },
  unknown: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const requestedToolName =
        typeof opts.tool.input?.requestedToolName === "string"
          ? opts.tool.input.requestedToolName
          : null;
      if (requestedToolName) {
        return formatHappyMcpToolTitle(requestedToolName);
      }
      return "Tool Call";
    },
    icon: ICON_PUZZLE,
    minimal: true,
    noStatus: true,
    input: z.object({}).partial().passthrough(),
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      const requestedToolName =
        typeof opts.tool.input?.requestedToolName === "string"
          ? opts.tool.input.requestedToolName
          : null;
      if (requestedToolName) {
        return formatHappyMcpToolAction(requestedToolName, "fallback");
      }
      return opts.tool.description || "Tool call";
    },
  },
  // Gemini internal tools - should be hidden (minimal)
  search: {
    title: t("tools.names.search"),
    icon: ICON_SEARCH,
    minimal: true,
    input: z
      .object({
        items: z.array(z.any()).optional(),
        locations: z.array(z.any()).optional(),
      })
      .partial()
      .passthrough(),
  },
  edit: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      // Gemini sends data in nested structure, try multiple locations
      let filePath: string | undefined;

      // 1. Check toolCall.content[0].path
      if (opts.tool.input?.toolCall?.content?.[0]?.path) {
        filePath = opts.tool.input.toolCall.content[0].path;
      }
      // 2. Check toolCall.title (has nice "Writing to ..." format)
      else if (opts.tool.input?.toolCall?.title) {
        return opts.tool.input.toolCall.title;
      }
      // 3. Check input[0].path (array format)
      else if (
        Array.isArray(opts.tool.input?.input) &&
        opts.tool.input.input[0]?.path
      ) {
        filePath = opts.tool.input.input[0].path;
      }
      // 4. Check direct path field
      else if (typeof opts.tool.input?.path === "string") {
        filePath = opts.tool.input.path;
      }

      if (filePath) {
        return resolveFileSummary(filePath, opts.metadata).displayName;
      }
      return t("tools.names.editFile");
    },
    icon: ICON_EDIT,
    isMutable: true,
    input: z
      .object({
        path: z.string().describe("The file path to edit"),
        oldText: z.string().describe("The text to replace"),
        newText: z.string().describe("The new text"),
        type: z.string().optional().describe("Type of edit (diff)"),
      })
      .partial()
      .passthrough(),
    extractStats: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const { oldText, newText } = extractGeminiEditPayload(opts.tool.input);
      return getTrimmedDiffStats(oldText, newText);
    },
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const { path } = extractGeminiEditPayload(opts.tool.input);
      if (path) {
        return resolveFileSubtitle(path, opts.metadata);
      }
      return null;
    },
  },
  shell: {
    title: t("tools.names.terminal"),
    icon: ICON_TERMINAL,
    minimal: true,
    input: z.object({}).partial().passthrough(),
  },
  execute: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      // Gemini sends nice title in toolCall.title
      if (opts.tool.input?.toolCall?.title) {
        // Title is like "rm file.txt [cwd /path] (description)"
        // Extract just the command part before [
        const fullTitle = opts.tool.input.toolCall.title;
        const bracketIdx = fullTitle.indexOf(" [");
        if (bracketIdx > 0) {
          return fullTitle.substring(0, bracketIdx);
        }
        return fullTitle;
      }
      return t("tools.names.terminal");
    },
    icon: ICON_TERMINAL,
    minimal: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const input = opts.tool.input;
      const title = input?.toolCall?.title;
      if (typeof title === "string" && title.trim().length > 0) {
        return false;
      }

      const command = input?.command;
      if (typeof command === "string" && command.trim().length > 0) {
        return false;
      }
      if (
        Array.isArray(command) &&
        command.some(
          (part) => typeof part === "string" && part.trim().length > 0,
        )
      ) {
        return false;
      }

      // No command arguments available: keep terminal tool in compact form.
      return true;
    },
    input: z.object({}).partial().passthrough(),
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      // Extract description from parentheses at the end
      if (opts.tool.input?.toolCall?.title) {
        const title = opts.tool.input.toolCall.title;
        const parenMatch = title.match(/\(([^)]+)\)$/);
        if (parenMatch) {
          return parenMatch[1];
        }
      }
      return null;
    },
  },
  CodexPatch: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (
        opts.tool.input?.changes &&
        typeof opts.tool.input.changes === "object"
      ) {
        const files = Object.keys(opts.tool.input.changes);
        const fileCount = files.length;
        if (fileCount === 1) {
          const path = resolvePath(files[0], opts.metadata);
          return path.split("/").pop() || path;
        }
        if (fileCount > 1) {
          return t("tools.desc.modifyingFiles", { count: fileCount });
        }
      }
      return t("tools.names.applyChanges");
    },
    icon: ICON_EDIT,
    minimal: true,
    hideDefaultError: true,
    input: z
      .object({
        auto_approved: z
          .boolean()
          .optional()
          .describe("Whether changes were auto-approved"),
        changes: z
          .record(
            z.string(),
            z
              .object({
                add: z
                  .object({
                    content: z.string(),
                  })
                  .optional(),
                modify: z
                  .object({
                    old_content: z.string(),
                    new_content: z.string(),
                  })
                  .optional(),
                delete: z
                  .object({
                    content: z.string(),
                  })
                  .optional(),
              })
              .passthrough(),
          )
          .describe("File changes to apply"),
      })
      .partial()
      .passthrough(),
    extractStats: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const entries = getCodexPatchEntries(opts.tool.input?.changes);
      return getCodexPatchTotals(entries);
    },
    extractSubtitle: () => null,
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      // Show the number of files being modified
      if (
        opts.tool.input?.changes &&
        typeof opts.tool.input.changes === "object"
      ) {
        const files = Object.keys(opts.tool.input.changes);
        const fileCount = files.length;
        if (fileCount === 1) {
          const path = resolvePath(files[0], opts.metadata);
          const fileName = path.split("/").pop() || path;
          return t("tools.desc.modifyingFile", { file: fileName });
        } else if (fileCount > 1) {
          return t("tools.desc.modifyingFiles", { count: fileCount });
        }
      }
      return t("tools.names.applyChanges");
    },
  },
  GeminiBash: {
    title: t("tools.names.terminal"),
    icon: ICON_TERMINAL,
    minimal: true,
    hideDefaultError: true,
    input: z
      .object({
        command: z.array(z.string()).describe("The command array to execute"),
        cwd: z.string().optional().describe("Current working directory"),
      })
      .partial()
      .passthrough(),
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (opts.tool.input?.command && Array.isArray(opts.tool.input.command)) {
        let cmdArray = opts.tool.input.command;
        // Remove shell wrapper prefix if present (bash/zsh with -lc flag)
        if (
          cmdArray.length >= 3 &&
          (cmdArray[0] === "bash" ||
            cmdArray[0] === "/bin/bash" ||
            cmdArray[0] === "zsh" ||
            cmdArray[0] === "/bin/zsh") &&
          cmdArray[1] === "-lc"
        ) {
          return cmdArray[2];
        }
        return cmdArray.join(" ");
      }
      return null;
    },
  },
  GeminiPatch: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (
        opts.tool.input?.changes &&
        typeof opts.tool.input.changes === "object"
      ) {
        const files = Object.keys(opts.tool.input.changes);
        const fileCount = files.length;
        if (fileCount === 1) {
          const path = resolvePath(files[0], opts.metadata);
          return path.split("/").pop() || path;
        }
        if (fileCount > 1) {
          return t("tools.desc.modifyingFiles", { count: fileCount });
        }
      }
      return t("tools.names.applyChanges");
    },
    icon: ICON_EDIT,
    minimal: true,
    hideDefaultError: true,
    isMutable: true,
    input: z
      .object({
        auto_approved: z
          .boolean()
          .optional()
          .describe("Whether changes were auto-approved"),
        changes: z
          .record(
            z.string(),
            z
              .object({
                add: z
                  .object({
                    content: z.string(),
                  })
                  .optional(),
                modify: z
                  .object({
                    old_content: z.string(),
                    new_content: z.string(),
                  })
                  .optional(),
                delete: z
                  .object({
                    content: z.string(),
                  })
                  .optional(),
              })
              .passthrough(),
          )
          .describe("File changes to apply"),
      })
      .partial()
      .passthrough(),
    extractStats: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      const entries = getCodexPatchEntries(opts.tool.input?.changes);
      return getCodexPatchTotals(entries);
    },
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      // Show the first file being modified
      if (
        opts.tool.input?.changes &&
        typeof opts.tool.input.changes === "object"
      ) {
        const files = Object.keys(opts.tool.input.changes);
        if (files.length > 0) {
          const path = resolvePath(files[0], opts.metadata);
          const fileName = path.split("/").pop() || path;
          if (files.length > 1) {
            return t("tools.desc.modifyingMultipleFiles", {
              file: fileName,
              count: files.length - 1,
            });
          }
          return fileName;
        }
      }
      return null;
    },
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      // Show the number of files being modified
      if (
        opts.tool.input?.changes &&
        typeof opts.tool.input.changes === "object"
      ) {
        const files = Object.keys(opts.tool.input.changes);
        const fileCount = files.length;
        if (fileCount === 1) {
          const path = resolvePath(files[0], opts.metadata);
          const fileName = path.split("/").pop() || path;
          return t("tools.desc.modifyingFile", { file: fileName });
        } else if (fileCount > 1) {
          return t("tools.desc.modifyingFiles", { count: fileCount });
        }
      }
      return t("tools.names.applyChanges");
    },
  },
  CodexDiff: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (
        opts.tool.input?.unified_diff &&
        typeof opts.tool.input.unified_diff === "string"
      ) {
        const parsed = parseCodexUnifiedDiff(opts.tool.input.unified_diff);
        if (parsed.fileName) {
          return parsed.fileName.split("/").pop() || parsed.fileName;
        }
      }
      return t("tools.names.viewDiff");
    },
    icon: ICON_EDIT,
    minimal: false, // Tool detail keeps the full diff view.
    hideDefaultError: true,
    noStatus: true, // Always successful, stateless like Task
    input: z
      .object({
        unified_diff: z.string().describe("Unified diff content"),
      })
      .partial()
      .passthrough(),
    result: z
      .object({
        status: z.literal("completed").describe("Always completed"),
      })
      .partial()
      .passthrough(),
    extractStats: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (
        opts.tool.input?.unified_diff &&
        typeof opts.tool.input.unified_diff === "string"
      ) {
        return getCodexDiffStats(opts.tool.input.unified_diff);
      }
      return null;
    },
    extractSubtitle: () => null,
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      return t("tools.desc.showingDiff");
    },
  },
  GeminiDiff: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (
        opts.tool.input?.filePath &&
        typeof opts.tool.input.filePath === "string"
      ) {
        const path = resolvePath(opts.tool.input.filePath, opts.metadata);
        return path.split("/").pop() || path;
      }
      if (
        opts.tool.input?.unified_diff &&
        typeof opts.tool.input.unified_diff === "string"
      ) {
        const parsed = parseCodexUnifiedDiff(opts.tool.input.unified_diff);
        if (parsed.fileName) {
          return parsed.fileName.split("/").pop() || parsed.fileName;
        }
      }
      return t("tools.names.viewDiff");
    },
    icon: ICON_EDIT,
    minimal: false, // Tool detail keeps the full diff view.
    hideDefaultError: true,
    noStatus: true, // Always successful, stateless like Task
    input: z
      .object({
        unified_diff: z.string().optional().describe("Unified diff content"),
        filePath: z.string().optional().describe("File path"),
        description: z.string().optional().describe("Edit description"),
      })
      .partial()
      .passthrough(),
    result: z
      .object({
        status: z.literal("completed").describe("Always completed"),
      })
      .partial()
      .passthrough(),
    extractStats: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (
        opts.tool.input?.unified_diff &&
        typeof opts.tool.input.unified_diff === "string"
      ) {
        return getCodexDiffStats(opts.tool.input.unified_diff);
      }
      return null;
    },
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      // Try to extract filename from filePath first
      if (
        opts.tool.input?.filePath &&
        typeof opts.tool.input.filePath === "string"
      ) {
        const basename =
          opts.tool.input.filePath.split("/").pop() || opts.tool.input.filePath;
        return basename;
      }
      // Fall back to extracting from unified diff
      if (
        opts.tool.input?.unified_diff &&
        typeof opts.tool.input.unified_diff === "string"
      ) {
        const diffLines = opts.tool.input.unified_diff.split("\n");
        for (const line of diffLines) {
          if (line.startsWith("+++ b/") || line.startsWith("+++ ")) {
            const fileName = line.replace(/^\+\+\+ (b\/)?/, "");
            const basename = fileName.split("/").pop() || fileName;
            return basename;
          }
        }
      }
      return null;
    },
    extractDescription: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => {
      return t("tools.desc.showingDiff");
    },
  },
  AskUserQuestion: {
    title: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (
        opts.tool.input?.questions &&
        Array.isArray(opts.tool.input.questions) &&
        opts.tool.input.questions.length > 0
      ) {
        const qs = opts.tool.input.questions;
        // Multi-question: show count; single: show header
        if (qs.length > 1) {
          return t("tools.askUserQuestion.multipleQuestions", {
            count: qs.length,
          });
        }
        if (qs[0].header) {
          return qs[0].header;
        }
      }
      return t("tools.names.question");
    },
    icon: ICON_QUESTION,
    minimal: false, // Always show expanded to display options
    noStatus: true,
    input: z
      .object({
        questions: z
          .array(
            z.object({
              question: z.string().describe("The question to ask"),
              header: z.string().describe("Short label for the question"),
              options: z
                .array(
                  z.object({
                    label: z.string().describe("Option label"),
                    description: z.string().describe("Option description"),
                    preview: z.string().optional().describe("Optional markdown preview content for this option"),
                  }),
                )
                .describe("Available choices"),
              multiSelect: z.boolean().describe("Allow multiple selections"),
            }),
          )
          .describe("Questions to ask the user"),
      })
      .partial()
      .passthrough(),
    extractSubtitle: (opts: { metadata: Metadata | null; tool: ToolCall }) => {
      if (
        opts.tool.input?.questions &&
        Array.isArray(opts.tool.input.questions)
      ) {
        const qs = opts.tool.input.questions;
        if (qs.length === 1) {
          return qs[0].question;
        }
        // Multi-question: show headers joined for more context
        const headers = qs
          .map((q: { header?: string }) => q.header)
          .filter(Boolean);
        if (headers.length > 0) {
          return headers.join(" · ");
        }
        return t("tools.askUserQuestion.multipleQuestions", {
          count: qs.length,
        });
      }
      return null;
    },
  },
  // Internal Claude Code tool for loading deferred tools - no user-visible output
  ToolSearch: {
    title: "ToolSearch",
    icon: ICON_SEARCH,
    hidden: true,
  },
} satisfies Record<
  string,
  {
    title?:
      | string
      | ((opts: { metadata: Metadata | null; tool: ToolCall }) => string);
    icon: (size: number, color: string) => React.ReactNode;
    noStatus?: boolean;
    hideDefaultError?: boolean;
    hidden?: boolean;
    isMutable?: boolean;
    input?: z.ZodObject<any>;
    result?: z.ZodObject<any>;
    minimal?:
      | boolean
      | ((opts: {
          metadata: Metadata | null;
          tool: ToolCall;
          messages?: Message[];
        }) => boolean);
    extractDescription?: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => string;
    extractSubtitle?: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => string | null;
    extractStatus?: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => string | null;
    extractStats?: (opts: {
      metadata: Metadata | null;
      tool: ToolCall;
    }) => { additions: number; deletions: number } | null;
  }
>;

/**
 * Check if a tool is mutable (can potentially modify files)
 * @param toolName The name of the tool to check
 * @returns true if the tool is mutable or unknown, false if it's read-only
 */
export function isMutableTool(toolName: string): boolean {
  const tool = knownTools[toolName as keyof typeof knownTools];
  if (tool) {
    if ("isMutable" in tool) {
      return tool.isMutable === true;
    } else {
      return false;
    }
  }
  // If tool is unknown, assume it's mutable to be safe
  return true;
}
