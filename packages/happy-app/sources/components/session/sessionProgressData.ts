import type { Metadata } from "@/sync/storageTypes";
import type { Message, ToolCall, ToolCallMessage } from "@/sync/typesMessage";

export type ProgressTodoStatus = "pending" | "in_progress" | "completed";

export interface ProgressTodo {
    content: string;
    status: ProgressTodoStatus;
    /** SDK-native imperative-present form shown for in_progress status. */
    activeForm?: string;
    /** SDK signal: item marked completed without sufficient verification. */
    verificationNudgeNeeded?: boolean;
    priority?: "high" | "medium" | "low";
    id?: string;
}

export interface ProgressFileEdit {
    path: string;
    edits: number;
    lastTouchedAt: number;
}

export interface ProgressCommand {
    command: string;
    count: number;
    lastRanAt: number;
}

export interface SessionProgressData {
    /**
     * Latest TodoWrite snapshot for this session. null if Claude has never
     * written a todo list (e.g. Codex session or short conversation).
     */
    todos: ProgressTodo[] | null;
    /** Timestamp of the most recent TodoWrite call (null if none). */
    todosUpdatedAt: number | null;
    /** Aggregated file edits from Edit/Write/MultiEdit/NotebookEdit tools. */
    files: ProgressFileEdit[];
    /** Aggregated bash commands (dedup by trimmed first line). */
    commands: ProgressCommand[];
    /** Count of user-text messages in the session. */
    userTurns: number;
    /** Count of agent-text messages in the session. */
    agentTurns: number;
    /** Count of tool invocations (any tool, any status). */
    toolCalls: number;
}

const FILE_EDIT_TOOLS = new Set([
    "Edit",
    "Write",
    "MultiEdit",
    "NotebookEdit",
    "str_replace_based_edit_tool",
    "create_file",
]);

function extractFilePath(tool: ToolCall): string | null {
    const input = tool.input;
    if (!input || typeof input !== "object") return null;
    const candidates = [
        (input as Record<string, unknown>).file_path,
        (input as Record<string, unknown>).path,
        (input as Record<string, unknown>).notebook_path,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.length > 0) return candidate;
    }
    return null;
}

function extractCommand(tool: ToolCall): string | null {
    const input = tool.input;
    if (!input || typeof input !== "object") return null;
    const command = (input as Record<string, unknown>).command;
    if (typeof command !== "string") return null;
    const firstLine = command.split("\n")[0]?.trim();
    return firstLine && firstLine.length > 0 ? firstLine : null;
}

function extractTodos(tool: ToolCall): ProgressTodo[] | null {
    // Prefer result.newTodos (post-execution state); fall back to input.todos
    // so a still-running TodoWrite call isn't invisible.
    const fromResult = tool.result?.newTodos;
    const fromInput = tool.input?.todos;
    const source = Array.isArray(fromResult) && fromResult.length > 0
        ? fromResult
        : Array.isArray(fromInput)
            ? fromInput
            : null;
    if (!source) return null;
    const verificationNudgeNeeded = Boolean(
        (tool.result as Record<string, unknown> | undefined)?.verificationNudgeNeeded,
    );
    const todos: ProgressTodo[] = [];
    for (const raw of source) {
        if (!raw || typeof raw !== "object") continue;
        const content = (raw as Record<string, unknown>).content;
        const status = (raw as Record<string, unknown>).status;
        if (typeof content !== "string" || content.length === 0) continue;
        if (status !== "pending" && status !== "in_progress" && status !== "completed") continue;
        const priority = (raw as Record<string, unknown>).priority;
        const id = (raw as Record<string, unknown>).id;
        const activeForm = (raw as Record<string, unknown>).activeForm;
        todos.push({
            content,
            status,
            activeForm: typeof activeForm === "string" && activeForm.length > 0
                ? activeForm
                : undefined,
            verificationNudgeNeeded:
                verificationNudgeNeeded && status === "completed" ? true : undefined,
            priority:
                priority === "high" || priority === "medium" || priority === "low"
                    ? priority
                    : undefined,
            id: typeof id === "string" ? id : undefined,
        });
    }
    return todos.length > 0 ? todos : null;
}

function collectToolCalls(messages: readonly Message[]): ToolCallMessage[] {
    const out: ToolCallMessage[] = [];
    const walk = (msg: Message) => {
        if (msg.kind === "tool-call") {
            out.push(msg);
            for (const child of msg.children) walk(child);
        }
    };
    for (const msg of messages) walk(msg);
    return out;
}

export function computeSessionProgress(messages: readonly Message[]): SessionProgressData {
    const toolCallMessages = collectToolCalls(messages);

    // Find latest TodoWrite — scan in reverse so we stop at the first match.
    let todos: ProgressTodo[] | null = null;
    let todosUpdatedAt: number | null = null;
    for (let i = toolCallMessages.length - 1; i >= 0; i--) {
        const msg = toolCallMessages[i]!;
        if (msg.tool.name !== "TodoWrite") continue;
        const extracted = extractTodos(msg.tool);
        if (extracted) {
            todos = extracted;
            todosUpdatedAt = msg.tool.completedAt ?? msg.tool.startedAt ?? msg.createdAt;
            break;
        }
    }

    const fileMap = new Map<string, ProgressFileEdit>();
    const commandMap = new Map<string, ProgressCommand>();
    let toolCalls = 0;
    for (const msg of toolCallMessages) {
        toolCalls += 1;
        const { tool } = msg;
        const touchedAt = tool.completedAt ?? tool.startedAt ?? msg.createdAt;
        if (FILE_EDIT_TOOLS.has(tool.name)) {
            const path = extractFilePath(tool);
            if (path) {
                const existing = fileMap.get(path);
                if (existing) {
                    existing.edits += 1;
                    if (touchedAt > existing.lastTouchedAt) existing.lastTouchedAt = touchedAt;
                } else {
                    fileMap.set(path, { path, edits: 1, lastTouchedAt: touchedAt });
                }
            }
        } else if (tool.name === "Bash" || tool.name === "BashOutput") {
            const command = extractCommand(tool);
            if (command) {
                const existing = commandMap.get(command);
                if (existing) {
                    existing.count += 1;
                    if (touchedAt > existing.lastRanAt) existing.lastRanAt = touchedAt;
                } else {
                    commandMap.set(command, { command, count: 1, lastRanAt: touchedAt });
                }
            }
        }
    }

    let userTurns = 0;
    let agentTurns = 0;
    for (const msg of messages) {
        if (msg.kind === "user-text") userTurns += 1;
        else if (msg.kind === "agent-text") agentTurns += 1;
    }

    const files = Array.from(fileMap.values()).sort(
        (a, b) => b.lastTouchedAt - a.lastTouchedAt,
    );
    const commands = Array.from(commandMap.values()).sort(
        (a, b) => b.lastRanAt - a.lastRanAt,
    );

    return {
        todos,
        todosUpdatedAt,
        files,
        commands,
        userTurns,
        agentTurns,
        toolCalls,
    };
}

export type ChecklistSource = "mcp" | "todowrite" | "none";

export interface ResolvedChecklist {
    source: ChecklistSource;
    /** Stable id when source is "mcp" and metadata has lists; undefined otherwise. */
    listId?: string;
    todos: ProgressTodo[];
    updatedAt: number | null;
    label?: string;
    currentStage?: string;
    blockers?: string[];
}

export interface ChecklistTabSummary {
    goal: string;
    currentFocus?: string;
    keyDecisions?: string[];
    openQuestions?: string[];
    impactScope?: string[];
    updatedAt: number;
}

export interface ChecklistTab {
    id: string;
    label: string;
    /** True when this is the currently active list (defaults to last if unset). */
    active: boolean;
    completed: number;
    total: number;
    updatedAt: number;
    archivedAt?: number;
    summary?: ChecklistTabSummary;
}

type MetadataProgress = NonNullable<Metadata["progress"]>;

type MetadataProgressList = NonNullable<MetadataProgress["lists"]>[number];

const LEGACY_PROGRESS_LIST_ID = "legacy-progress";

function mapMetadataTodo(todo: MetadataProgressList["todos"][number]): ProgressTodo {
    return {
        content: todo.content,
        status: todo.status,
        activeForm: todo.activeForm,
        verificationNudgeNeeded: todo.verificationNudgeNeeded,
    };
}

function normalizeLegacyTodos(
    todos: NonNullable<MetadataProgress["todos"]>,
): ProgressTodo[] {
    return todos.map((todo) => ({
        content: todo.content,
        status: todo.status,
        activeForm: todo.activeForm,
        verificationNudgeNeeded: todo.verificationNudgeNeeded,
    }));
}

function deriveLabelFromTodos(todos: readonly ProgressTodo[]): string | undefined {
    return todos[0]?.content;
}

function normalizeProgressLists(
    metadataProgress: MetadataProgress,
): {
    lists: MetadataProgressList[];
    currentListId: string | undefined;
} {
    const lists = metadataProgress.lists;
    if (lists && lists.length > 0) {
        return {
            lists,
            currentListId: metadataProgress.currentListId,
        };
    }

    if (metadataProgress.todos !== undefined) {
        const normalizedTodos = normalizeLegacyTodos(metadataProgress.todos);
        return {
            lists: [
                {
                    id: LEGACY_PROGRESS_LIST_ID,
                    label: deriveLabelFromTodos(normalizedTodos),
                    todos: metadataProgress.todos.map((todo) => ({
                        content: todo.content,
                        status: todo.status,
                        activeForm: todo.activeForm,
                        stage: todo.stage,
                        verificationNudgeNeeded: todo.verificationNudgeNeeded,
                    })),
                    currentStage: metadataProgress.currentStage,
                    blockers: metadataProgress.blockers,
                    startedAt: metadataProgress.updatedAt,
                    updatedAt: metadataProgress.updatedAt,
                },
            ],
            currentListId: LEGACY_PROGRESS_LIST_ID,
        };
    }

    return {
        lists: [],
        currentListId: undefined,
    };
}

function pickActiveList(
    lists: readonly MetadataProgressList[],
    currentListId: string | undefined,
): MetadataProgressList | undefined {
    if (currentListId) {
        const match = lists.find((l) => l.id === currentListId);
        if (match) return match;
    }
    // Default: last non-archived list, else the last one overall.
    for (let i = lists.length - 1; i >= 0; i--) {
        const list = lists[i]!;
        if (!list.archivedAt) return list;
    }
    return lists[lists.length - 1];
}

/**
 * Pick the authoritative checklist source for the Progress tab.
 *
 * Priority:
 *   1. MCP-sourced `metadata.progress`, normalized into list form
 *      (legacy flat `todos` becomes a synthetic single list)
 *   2. Latest TodoWrite in message history (fallback when CLI auto-mirror /
 *      MCP haven't populated metadata yet)
 *   3. Empty
 */
export function resolveChecklist(
    metadataProgress: Metadata["progress"] | null | undefined,
    messagesAggregate: Pick<SessionProgressData, "todos" | "todosUpdatedAt">,
    /** Optional: render a specific list from metadata.progress.lists. */
    preferredListId?: string,
): ResolvedChecklist {
    if (metadataProgress) {
        const normalized = normalizeProgressLists(metadataProgress);
        if (normalized.lists.length > 0) {
            const targetId = preferredListId ?? normalized.currentListId;
            const active = pickActiveList(normalized.lists, targetId);
            if (active) {
                const todos = active.todos.map(mapMetadataTodo);
                return {
                    source: "mcp",
                    listId: active.id,
                    todos,
                    updatedAt: active.updatedAt,
                    label: active.label ?? deriveLabelFromTodos(todos),
                    currentStage: active.currentStage,
                    blockers: active.blockers,
                };
            }
        } else {
            return {
                source: "mcp",
                todos: [],
                updatedAt: metadataProgress.updatedAt,
                currentStage: metadataProgress.currentStage,
                blockers: metadataProgress.blockers,
            };
        }
    }
    if (messagesAggregate.todos && messagesAggregate.todos.length > 0) {
        return {
            source: "todowrite",
            todos: messagesAggregate.todos.slice(),
            updatedAt: messagesAggregate.todosUpdatedAt,
        };
    }
    return {
        source: "none",
        todos: [],
        updatedAt: null,
    };
}

/**
 * Build the tab-row data for the Progress panel. Returns empty array when
 * metadata.progress has no multi-list shape (caller falls back to single
 * checklist view).
 */
export function getChecklistTabs(
    metadataProgress: Metadata["progress"] | null | undefined,
): ChecklistTab[] {
    if (!metadataProgress) return [];
    const normalized = normalizeProgressLists(metadataProgress);
    const lists = normalized.lists;
    if (lists.length === 0) return [];
    const activeId =
        normalized.currentListId ??
        pickActiveList(lists, undefined)?.id;
    return lists.map((list) => {
        const todos = list.todos;
        const completed = todos.filter((t) => t.status === "completed").length;
        return {
            id: list.id,
            label: list.label ?? deriveLabelFromTodos(todos.map(mapMetadataTodo)) ?? list.id,
            active: list.id === activeId,
            completed,
            total: todos.length,
            updatedAt: list.updatedAt,
            archivedAt: list.archivedAt,
            summary: list.summary ?? undefined,
        };
    });
}

export interface TodoProgressCounts {
    completed: number;
    inProgress: number;
    pending: number;
    total: number;
    /** 0-1 fraction of completed / total (0 if total is 0). */
    completionRatio: number;
}

export function countTodoProgress(todos: readonly ProgressTodo[] | null): TodoProgressCounts {
    if (!todos || todos.length === 0) {
        return { completed: 0, inProgress: 0, pending: 0, total: 0, completionRatio: 0 };
    }
    let completed = 0;
    let inProgress = 0;
    let pending = 0;
    for (const todo of todos) {
        if (todo.status === "completed") completed += 1;
        else if (todo.status === "in_progress") inProgress += 1;
        else pending += 1;
    }
    const total = todos.length;
    return {
        completed,
        inProgress,
        pending,
        total,
        completionRatio: total > 0 ? completed / total : 0,
    };
}
