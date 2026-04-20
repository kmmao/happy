type BoundaryTodo = {
  content: string;
  status?: "pending" | "in_progress" | "completed";
};

function normalizeTodoContentSet(
  todos: readonly Pick<BoundaryTodo, "content">[],
): Set<string> {
  return new Set(
    todos
      .map((todo) => todo.content.trim())
      .filter((content) => content.length > 0),
  );
}

function calculateOverlapRatio(
  priorTodos: readonly Pick<BoundaryTodo, "content">[],
  nextTodos: readonly Pick<BoundaryTodo, "content">[],
): number {
  const priorKeys = normalizeTodoContentSet(priorTodos);
  const nextKeys = normalizeTodoContentSet(nextTodos);

  if (priorKeys.size === 0 || nextKeys.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const key of nextKeys) {
    if (priorKeys.has(key)) {
      intersection += 1;
    }
  }

  const union = priorKeys.size + nextKeys.size - intersection;
  return union > 0 ? intersection / union : 1;
}

function areAllTodosCompleted(
  todos: readonly Pick<BoundaryTodo, "status">[],
): boolean {
  return todos.length > 0 && todos.every((todo) => todo.status === "completed");
}

export function shouldStartNewProgressList(
  priorTodos: readonly BoundaryTodo[],
  nextTodos: readonly BoundaryTodo[],
  options?: {
    requirePriorCompleted?: boolean;
    maxOverlapRatio?: number;
  },
): boolean {
  const priorKeys = normalizeTodoContentSet(priorTodos);
  const nextKeys = normalizeTodoContentSet(nextTodos);
  if (priorKeys.size === 0 || nextKeys.size === 0) {
    return false;
  }

  if (
    options?.requirePriorCompleted === true &&
    !areAllTodosCompleted(priorTodos)
  ) {
    return false;
  }

  const overlapRatio = calculateOverlapRatio(priorTodos, nextTodos);
  return overlapRatio < (options?.maxOverlapRatio ?? 0.3);
}

