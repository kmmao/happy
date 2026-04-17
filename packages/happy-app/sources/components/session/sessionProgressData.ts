import type { Metadata } from "@/sync/storageTypes";
import type { Message, ToolCall, ToolCallMessage } from "@/sync/typesMessage";

export type ProgressTodoStatus = "pending" | "in_progress" | "completed";

export interface ProgressTodo {
    content: string;
    status: ProgressTodoStatus;
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
    const todos: ProgressTodo[] = [];
    for (const raw of source) {
        if (!raw || typeof raw !== "object") continue;
        const content = (raw as Record<string, unknown>).content;
        const status = (raw as Record<string, unknown>).status;
        if (typeof content !== "string" || content.length === 0) continue;
        if (status !== "pending" && status !== "in_progress" && status !== "completed") continue;
        const priority = (raw as Record<string, unknown>).priority;
        const id = (raw as Record<string, unknown>).id;
        todos.push({
            content,
            status,
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
    todos: ProgressTodo[];
    updatedAt: number | null;
    currentStage?: string;
    blockers?: string[];
}

/**
 * Pick the authoritative checklist source for the Progress tab.
 *
 * Priority:
 *   1. MCP-sourced `metadata.progress` (written by Agent via update_progress)
 *   2. Latest TodoWrite in message history (fallback when Agent hasn't
 *      started using the MCP tool yet, e.g. Codex or older CLI)
 *   3. Empty
 *
 * We intentionally do not fall back to markdown checklist parsing — it was
 * considered but the MCP contract is meant to supersede all heuristics. If
 * the Agent is silent, the user presses the manual "refresh" button instead.
 */
export function resolveChecklist(
    metadataProgress: Metadata["progress"] | null | undefined,
    messagesAggregate: Pick<SessionProgressData, "todos" | "todosUpdatedAt">,
): ResolvedChecklist {
    if (metadataProgress && metadataProgress.todos.length > 0) {
        return {
            source: "mcp",
            todos: metadataProgress.todos.map((todo) => ({
                content: todo.content,
                status: todo.status,
            })),
            updatedAt: metadataProgress.updatedAt,
            currentStage: metadataProgress.currentStage,
            blockers: metadataProgress.blockers,
        };
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
