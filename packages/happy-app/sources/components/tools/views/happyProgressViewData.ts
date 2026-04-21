import type { Message } from "@/sync/typesMessage";
import type { AgentEvent } from "@/sync/typesRaw";

export type HappyProgressTodoStatus = "pending" | "in_progress" | "completed";

export interface HappyProgressTodo {
  readonly content: string;
  readonly status: HappyProgressTodoStatus;
  readonly activeForm?: string;
  readonly stage?: string;
}

export interface HappyProgressSummary {
  readonly explanation: string | null;
  readonly currentStage: string | null;
  readonly label: string | null;
  readonly blockers: readonly string[];
  readonly todos: readonly HappyProgressTodo[];
  readonly counts: {
    readonly total: number;
    readonly completed: number;
    readonly inProgress: number;
    readonly pending: number;
  };
}

export interface CollapsedProgressTodos {
  readonly visibleTodos: readonly HappyProgressTodo[];
  readonly hiddenCount: number;
  readonly didCollapse: boolean;
}

export function shouldCollapseProgressExplanation(
  explanation: string | null | undefined,
): boolean {
  if (!explanation) {
    return false;
  }
  const trimmed = explanation.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return trimmed.length > 90 || trimmed.includes("\n");
}

export function collapseProgressTodos(
  todos: readonly HappyProgressTodo[],
  maxVisible = 4,
): CollapsedProgressTodos {
  if (todos.length <= maxVisible) {
    return {
      visibleTodos: todos,
      hiddenCount: 0,
      didCollapse: false,
    };
  }

  let requiredVisible = maxVisible;
  for (let index = 0; index < todos.length; index += 1) {
    const todo = todos[index]!;
    if (todo.status !== "completed") {
      requiredVisible = Math.max(requiredVisible, index + 1);
    }
  }

  const visibleCount = Math.min(requiredVisible, todos.length);
  const hiddenCount = Math.max(0, todos.length - visibleCount);

  return {
    visibleTodos: todos.slice(0, visibleCount),
    hiddenCount,
    didCollapse: hiddenCount > 0,
  };
}

const VALID_TODO_STATUSES = new Set<HappyProgressTodoStatus>([
  "pending",
  "in_progress",
  "completed",
]);

function trimString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function summarizeHappyProgressInput(input: unknown): HappyProgressSummary {
  const record =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};

  const todos = Array.isArray(record.todos)
    ? record.todos
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const todo = entry as Record<string, unknown>;
          const content = trimString(todo.content);
          const status = todo.status;
          if (
            !content ||
            typeof status !== "string" ||
            !VALID_TODO_STATUSES.has(status as HappyProgressTodoStatus)
          ) {
            return null;
          }
          return {
            content,
            status: status as HappyProgressTodoStatus,
            ...(trimString(todo.activeForm)
              ? { activeForm: trimString(todo.activeForm) ?? undefined }
              : {}),
            ...(trimString(todo.stage)
              ? { stage: trimString(todo.stage) ?? undefined }
              : {}),
          } satisfies HappyProgressTodo;
        })
        .filter((todo): todo is HappyProgressTodo => todo !== null)
    : [];

  const blockers = Array.isArray(record.blockers)
    ? record.blockers
        .map(trimString)
        .filter((value: string | null): value is string => value !== null)
    : [];

  const completed = todos.filter((todo) => todo.status === "completed").length;
  const inProgress = todos.filter((todo) => todo.status === "in_progress").length;
  const pending = todos.filter((todo) => todo.status === "pending").length;

  return {
    explanation:
      trimString(record._derivedExplanation) ?? trimString(record.explanation),
    currentStage: trimString(record.currentStage),
    label: trimString(record.label),
    blockers,
    todos,
    counts: {
      total: todos.length,
      completed,
      inProgress,
      pending,
    },
  };
}

function getEventTokenCount(event: AgentEvent): number {
  if ("usage" in event && event.usage) {
    return (
      event.usage.input_tokens +
      event.usage.output_tokens +
      (event.usage.cache_creation_input_tokens ?? 0) +
      (event.usage.cache_read_input_tokens ?? 0)
    );
  }

  if ("modelUsage" in event && event.modelUsage) {
    return Object.values(event.modelUsage).reduce(
      (total, usage) =>
        total +
        usage.inputTokens +
        usage.outputTokens +
        usage.cacheCreationInputTokens +
        usage.cacheReadInputTokens,
      0,
    );
  }

  return 0;
}

function walkMessages(
  messages: readonly Message[],
  visit: (message: Message) => void,
): void {
  for (const message of messages) {
    visit(message);
    if (message.kind === "tool-call") {
      walkMessages(message.children, visit);
    }
  }
}

export function countHappyProgressTokens(messages: readonly Message[]): number {
  let total = 0;
  walkMessages(messages, (message) => {
    if (message.kind !== "agent-event") {
      return;
    }
    total += getEventTokenCount(message.event as AgentEvent);
  });
  return total;
}
