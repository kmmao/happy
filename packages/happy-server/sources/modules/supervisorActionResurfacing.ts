/**
 * Pure resurfacing rules for SupervisorActions.
 *
 * When a SupervisorRun reports findings, each one must be reconciled against the
 * project's still-open SupervisorActions (those in approval state `pending`,
 * `skipped`, or `ignored`). The rules are invariant-dense and bug-prone, so they
 * live here as a pure function — no DB, no Prisma — and are pinned by
 * `supervisorActionResurfacing.spec.ts`. `supervisorRunStatusApply` reads the
 * project's open actions, calls {@link classifyReportedActions}, and turns the
 * returned plan into the actual `supervisorAction` writes (DB ownership stays in
 * the apply module).
 *
 * Reconciliation, keyed by `category::title`:
 *   - no existing match           → CREATE a fresh action
 *   - matches a `pending` action  → UPDATE it in place (bump lastSeenRunId + fields)
 *   - matches a `skipped` action  → RESTORE it to `pending` (the finding came back)
 *   - matches an `ignored` action → SUPPRESS (bump lastSeenRunId only; stays ignored)
 *
 * When several open actions share one key, the highest-priority approval wins:
 * `pending` > `skipped` > `ignored`. Within one approval, the caller's input
 * order is the tiebreak (apply passes existing actions ordered by `updatedAt`
 * desc, so the most-recent row wins).
 */

/** The approval states an open SupervisorAction can be in for resurfacing. */
export type OpenApproval = "pending" | "skipped" | "ignored";

/** Minimal shape of an existing open SupervisorAction the classifier needs. */
export interface ExistingActionRow {
    id: string;
    category: string;
    title: string;
    approval: string;
}

/** Minimal shape of a reported finding the classifier needs. */
export interface ReportedActionKey {
    category: string;
    title: string;
}

/**
 * A behaviour-free reconciliation plan. The apply module turns each bucket into
 * Prisma writes; `toSuppress` carries only ids because an ignored match's row
 * fields are intentionally left untouched (only its lastSeenRunId is bumped).
 */
export interface ActionResurfacingPlan<A> {
    /** Unmatched findings → createMany. */
    toCreate: A[];
    /** Matched a pending action → update fields in place. */
    toUpdatePending: { id: string; action: A }[];
    /** Matched a skipped action → restore to pending + update fields. */
    toRestoreFromSkip: { id: string; action: A }[];
    /** Matched an ignored action → bump lastSeenRunId only, stays suppressed. */
    toSuppressIgnored: { id: string }[];
}

const APPROVAL_PRIORITY: Record<string, number> = {
    pending: 3,
    skipped: 2,
    ignored: 1,
};

function actionKey(a: ReportedActionKey): string {
    return `${a.category}::${a.title}`;
}

/**
 * Reconcile reported findings against the project's open SupervisorActions.
 * Pure: same inputs always produce the same plan.
 */
export function classifyReportedActions<A extends ReportedActionKey>(
    reportedActions: readonly A[],
    existingActions: readonly ExistingActionRow[],
): ActionResurfacingPlan<A> {
    // category::title → the highest-priority open row for that key.
    const existingByKey = new Map<string, { id: string; approval: string }>();
    for (const a of existingActions) {
        const key = actionKey(a);
        const current = existingByKey.get(key);
        if (
            !current ||
            (APPROVAL_PRIORITY[a.approval] ?? 0) > (APPROVAL_PRIORITY[current.approval] ?? 0)
        ) {
            existingByKey.set(key, { id: a.id, approval: a.approval });
        }
    }

    const plan: ActionResurfacingPlan<A> = {
        toCreate: [],
        toUpdatePending: [],
        toRestoreFromSkip: [],
        toSuppressIgnored: [],
    };

    for (const action of reportedActions) {
        const existing = existingByKey.get(actionKey(action));
        if (!existing) {
            plan.toCreate.push(action);
        } else if (existing.approval === "pending") {
            plan.toUpdatePending.push({ id: existing.id, action });
        } else if (existing.approval === "skipped") {
            plan.toRestoreFromSkip.push({ id: existing.id, action });
        } else if (existing.approval === "ignored") {
            plan.toSuppressIgnored.push({ id: existing.id });
        }
    }

    return plan;
}
