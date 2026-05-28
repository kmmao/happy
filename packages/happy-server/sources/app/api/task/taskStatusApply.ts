import { type Task } from "@prisma/client";
import { db } from "@/storage/db";
import { eventRouter, buildTaskStatusChangedEphemeral } from "@/app/events/eventRouter";
import { decideTaskTransition, type TaskStatus } from "@/modules/taskStatusLogic";

/** Validated, already-authenticated input for one task status landing. */
export interface TaskStatusApplyInput {
    userId: string;
    taskId: string;
    /** The status to land — already run through {@link normalizeTaskStatusReport}. */
    resolvedStatus: TaskStatus;
    sessionId?: string;
    errorMessage?: string;
    /** Transition clock; defaults to now. Injectable for tests. */
    now?: Date;
}

/**
 * Outcome of landing a task status. `{ ok: false }` carries the reason a caller
 * must branch on — `not-found` (no such task for the user), `stale` (a backward
 * transition was rejected), or `duplicate-terminal` (the same terminal status
 * re-reported). The two non-not-found rejections echo the unchanged `task` so
 * callers can serialize it without a re-read. `{ ok: true }` carries the
 * refreshed row plus whether the new status is terminal (so a caller can fire
 * its own terminal-only side-effect, e.g. inbox).
 */
export type TaskStatusApplyResult =
    | { ok: false; reason: "not-found" }
    | { ok: false; reason: "stale" | "duplicate-terminal"; task: Task }
    | { ok: true; task: Task; isTerminal: boolean };

/**
 * Land one task status change and notify the App.
 *
 * The socket `task-status` handler and the `/v1/tasks/status` route used to be
 * near-duplicate ~25-line dances around {@link decideTaskTransition} — the same
 * read → decide → guarded update (identical update data) → identical
 * `task-status-changed` ephemeral — that could drift in the bug-prone parts (one
 * forgetting to emit, the two writing different columns). This concentrates that
 * single "a task reached status X" invariant: find the task, delegate the
 * stale/terminal/timestamp decision, apply the update, and emit the App
 * notification. Each transport keeps its own *outward* parts — the socket path's
 * terminal inbox item and silent not-found, the route's 404 / `{ ignored }`
 * response shapes — and just consumes this result.
 *
 * The `/v1/tasks/result` route deliberately does NOT route through here: it
 * lands its status inside a transaction alongside replay-key idempotency and a
 * `session_end` sessionEvent, and emits only after commit — a distinct
 * transactional transport, not this fire-and-emit one.
 */
export async function taskStatusApply(
    input: TaskStatusApplyInput,
): Promise<TaskStatusApplyResult> {
    const { userId, taskId, resolvedStatus, sessionId, errorMessage, now } = input;

    const task = await db.task.findFirst({
        where: { id: taskId, accountId: userId },
    });
    if (!task) {
        return { ok: false, reason: "not-found" };
    }

    const decision = decideTaskTransition({
        current: { status: task.status, dispatchedAt: task.dispatchedAt },
        resolvedStatus,
        now: now ?? new Date(),
    });
    if (!decision.apply) {
        return { ok: false, reason: decision.reason, task };
    }

    const updated = await db.task.update({
        where: { id: taskId },
        data: {
            status: resolvedStatus,
            sessionId: sessionId ?? task.sessionId,
            errorMessage: errorMessage ?? task.errorMessage,
            ...decision.timestamps,
        },
    });

    eventRouter.emitEphemeral({
        userId,
        payload: buildTaskStatusChangedEphemeral({
            taskId,
            machineId: task.machineId,
            status: resolvedStatus,
            sessionId: updated.sessionId ?? undefined,
            errorMessage: updated.errorMessage ?? undefined,
            completedAt: updated.completedAt?.getTime(),
            triggerType: task.triggerType,
        }),
        recipientFilter: { type: "user-scoped-only" },
    });

    return { ok: true, task: updated, isTerminal: decision.isTerminal };
}
