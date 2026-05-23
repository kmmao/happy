import { z } from "zod";

export const HAPPY_MCP_TOOL_NAMES = [
  "change_title",
  "query_project_knowledge",
  "update_progress",
  "update_session_summary",
  "ask_user",
] as const;

export type HappyMcpCanonicalToolName = (typeof HAPPY_MCP_TOOL_NAMES)[number];
export type HappyMcpToolActionMode = "dynamic" | "permission" | "fallback";

type HappyMcpToolSpec = {
  title: string;
  description: string;
  failureLabel: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  hideSuccessfulCall: boolean;
  autoApproveByDefault: boolean;
  permissionAction: string;
  dynamicAction: string;
  fallbackAction: string;
  reasonPhrases: string[];
};

export const HAPPY_MCP_TOOL_SPECS: Record<
  HappyMcpCanonicalToolName,
  HappyMcpToolSpec
> = {
  change_title: {
    title: "Change Title",
    description:
      'Set or update the chat session title. Titles should be short (under 50 chars) and action-oriented, e.g. "Fix auth token refresh".',
    failureLabel: "Failed to change chat title",
    inputSchema: {
      title: z.string().describe("The new title for the chat session"),
    },
    hideSuccessfulCall: true,
    autoApproveByDefault: true,
    permissionAction: "Waiting for approval to update chat title",
    dynamicAction: "Updating chat title",
    fallbackAction: "Update chat title",
    reasonPhrases: ["title update", "title updates", "change_title"],
  },
  query_project_knowledge: {
    title: "Project Knowledge",
    description:
      "Search the project knowledge base for relevant context, past decisions, known pitfalls, and conventions.",
    failureLabel: "Knowledge query failed",
    inputSchema: {
      query: z.string().describe("Search query describing what you want to know"),
    },
    hideSuccessfulCall: false,
    autoApproveByDefault: false,
    permissionAction: "Waiting for approval to search project knowledge",
    dynamicAction: "Searching project knowledge",
    fallbackAction: "Search project knowledge",
    reasonPhrases: [],
  },
  update_progress: {
    title: "Update Progress",
    description:
      'Optional override for the App\'s Progress tab. In most cases your TodoWrite calls are auto-mirrored, so you do NOT need to call this. Use it only when you want to set extra fields the CLI hook does not capture (currentStage, blockers) or to force a new list boundary with `listId: "new"`.',
    failureLabel: "Failed to update progress",
    inputSchema: {
      todos: z
        .array(
          z.object({
            content: z.string().describe("Concise description of the task"),
            status: z
              .enum(["pending", "in_progress", "completed"])
              .describe("Current status of the task"),
            activeForm: z
              .string()
              .optional()
              .describe(
                "Imperative-present form shown when status is in_progress",
              ),
            stage: z.string().optional().describe("Optional phase/stage label"),
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
      listId: z
        .string()
        .optional()
        .describe("Target list id. Use 'new' to force a fresh list"),
      label: z
        .string()
        .optional()
        .describe("Short human-readable name for this task list"),
    },
    hideSuccessfulCall: false,
    autoApproveByDefault: true,
    permissionAction: "Waiting for approval to update progress",
    dynamicAction: "Updating progress",
    fallbackAction: "Update progress",
    reasonPhrases: ["progress update", "progress updates", "update_progress"],
  },
  ask_user: {
    title: "Ask User",
    description:
      "Ask the user one or more questions via the App's native picker UI. " +
      "Use this whenever AskUserQuestion is unavailable (the host has disabled it — " +
      "common when running under happy-cli's PTY-mode Claude TUI). The input schema " +
      "is identical to AskUserQuestion's. The tool blocks until the user submits " +
      "answers in the App, then returns them as a JSON string keyed by question text.",
    failureLabel: "Failed to get user answer",
    inputSchema: {
      questions: z
        .array(
          z.object({
            question: z.string().describe("The question to ask the user"),
            header: z.string().describe("Short label/chip for the question (max ~12 chars)"),
            options: z
              .array(
                z.object({
                  label: z.string().describe("Option label"),
                  description: z.string().describe("Option description"),
                  preview: z
                    .string()
                    .optional()
                    .describe("Optional preview content shown when the option is focused"),
                }),
              )
              .describe("Available choices for this question (2-4 options)"),
            multiSelect: z
              .boolean()
              .describe("Allow multiple selections instead of single-select"),
          }),
        )
        .describe("Questions to ask the user (1-4 questions)"),
    },
    hideSuccessfulCall: false,
    autoApproveByDefault: false,
    permissionAction: "Waiting for user to answer",
    dynamicAction: "Waiting for user to answer",
    fallbackAction: "Ask user",
    reasonPhrases: ["ask user", "user input", "ask_user"],
  },
  update_session_summary: {
    title: "Update Session Summary",
    description:
      "Write a narrative session summary the App shows above the progress checklist. Call at milestones, not per task: after first understanding the goal, when scope shifts significantly, when key decisions are made, or when moving to a new phase. Full rewrite each call.",
    failureLabel: "Failed to update session summary",
    inputSchema: {
      goal: z.string().describe("What the user ultimately wants to accomplish"),
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
      requestId: z
        .string()
        .optional()
        .describe(
          "Optional request identifier that runtimes may record in sessionSummaryRefresh recent history for request-level confirmation",
        ),
    },
    hideSuccessfulCall: false,
    autoApproveByDefault: true,
    permissionAction: "Waiting for approval to update session summary",
    dynamicAction: "Updating session summary",
    fallbackAction: "Update session summary",
    reasonPhrases: [
      "session summary",
      "update_session_summary",
      "summary update",
    ],
  },
};

const HAPPY_MCP_TOOL_NAME_SET = new Set<string>(HAPPY_MCP_TOOL_NAMES);

export const HAPPY_MCP_AUTO_APPROVE_TOOL_NAMES = HAPPY_MCP_TOOL_NAMES.filter(
  (toolName) => HAPPY_MCP_TOOL_SPECS[toolName].autoApproveByDefault,
) as HappyMcpCanonicalToolName[];

export const HAPPY_MCP_SILENT_SUCCESS_TOOL_NAMES = HAPPY_MCP_TOOL_NAMES.filter(
  (toolName) => HAPPY_MCP_TOOL_SPECS[toolName].hideSuccessfulCall,
) as HappyMcpCanonicalToolName[];

export function getHappyMcpToolAliases(
  toolName: HappyMcpCanonicalToolName,
): readonly string[] {
  return [
    toolName,
    `happy__${toolName}`,
    `mcp__happy__${toolName}`,
  ] as const;
}

export function normalizeHappyMcpToolName(
  toolName: string | null | undefined,
): HappyMcpCanonicalToolName | null {
  if (typeof toolName !== "string") {
    return null;
  }

  const trimmed = toolName.trim();
  if (!trimmed) {
    return null;
  }

  if (HAPPY_MCP_TOOL_NAME_SET.has(trimmed)) {
    return trimmed as HappyMcpCanonicalToolName;
  }

  const withoutNamespace = trimmed.startsWith("mcp__happy__")
    ? trimmed.slice("mcp__happy__".length)
    : trimmed.startsWith("happy__")
      ? trimmed.slice("happy__".length)
      : null;

  if (withoutNamespace && HAPPY_MCP_TOOL_NAME_SET.has(withoutNamespace)) {
    return withoutNamespace as HappyMcpCanonicalToolName;
  }

  return null;
}

export function isHappyMcpToolName(
  toolName: string | null | undefined,
): boolean {
  return normalizeHappyMcpToolName(toolName) !== null;
}

export function isHappyMcpToolAlias(
  toolName: string | null | undefined,
  canonicalToolName: HappyMcpCanonicalToolName,
): boolean {
  return normalizeHappyMcpToolName(toolName) === canonicalToolName;
}

export function getHappyMcpToolTitle(
  toolName: string | null | undefined,
): string | null {
  const canonical = normalizeHappyMcpToolName(toolName);
  return canonical ? HAPPY_MCP_TOOL_SPECS[canonical].title : null;
}

export function getHappyMcpToolAction(
  toolName: string | null | undefined,
  mode: HappyMcpToolActionMode,
): string | null {
  const canonical = normalizeHappyMcpToolName(toolName);
  if (!canonical) {
    return null;
  }

  const spec = HAPPY_MCP_TOOL_SPECS[canonical];
  if (mode === "permission") {
    return spec.permissionAction;
  }
  if (mode === "dynamic") {
    return spec.dynamicAction;
  }
  return spec.fallbackAction;
}

export function shouldHideSuccessfulHappyMcpTool(
  toolName: string | null | undefined,
): boolean {
  const canonical = normalizeHappyMcpToolName(toolName);
  return canonical ? HAPPY_MCP_TOOL_SPECS[canonical].hideSuccessfulCall : false;
}

export function shouldAutoApproveHappyMcpToolName(
  toolName: string | null | undefined,
): boolean {
  const canonical = normalizeHappyMcpToolName(toolName);
  return canonical
    ? HAPPY_MCP_TOOL_SPECS[canonical].autoApproveByDefault
    : false;
}

/**
 * Wire schema for the `ask_user_response` session-level RPC.
 *
 * The App calls this when the user submits answers to a `mcp__happy__ask_user`
 * prompt. The handler in happy-cli (PTY mode) resolves the corresponding
 * pending MCP tool invocation so its `await` returns and Claude TUI receives
 * the user's answers as the tool result. Lives next to the tool spec rather
 * than in `claudeControlRpc.ts` because it's a Happy-MCP companion call, not a
 * Claude runtime sidebar API.
 */
export const AskUserResponseRequestSchema = z
  .object({
    askId: z.string(),
    answers: z.record(z.string(), z.string()),
  })
  .strict();
export type AskUserResponseRequest = z.infer<typeof AskUserResponseRequestSchema>;

export const AskUserResponseResultSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();
export type AskUserResponseResult = z.infer<typeof AskUserResponseResultSchema>;

export function shouldAutoApproveHappyMcpReason(
  reason: string | null | undefined,
): boolean {
  if (typeof reason !== "string") {
    return false;
  }

  const normalizedReason = reason.toLowerCase();
  if (!normalizedReason.includes("happy")) {
    return false;
  }

  return HAPPY_MCP_AUTO_APPROVE_TOOL_NAMES.some((toolName) =>
    HAPPY_MCP_TOOL_SPECS[toolName].reasonPhrases.some((phrase) =>
      normalizedReason.includes(phrase),
    ),
  );
}
