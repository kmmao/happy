import { RelationshipStatus } from "@prisma/client";

export type RelationshipOp = "add" | "remove";

/**
 * The pure decision for a bidirectional friendship transition.
 *
 * A friendship is a PAIR of directed statuses — `current→target` and
 * `target→current` — that must stay mutually consistent (friend⟺friend,
 * requested⟺pending, …). This decision owns that invariant: given the current
 * pair and the operation, it returns the new pair plus the side-effects the
 * caller must apply. `undefined` for a side means "leave it unchanged".
 */
export interface RelationshipTransition {
    /** New status for current→target; `undefined` = leave unchanged. */
    currentNext?: RelationshipStatus;
    /** New status for target→current; `undefined` = leave unchanged. */
    targetNext?: RelationshipStatus;
    /** Notification to send after the writes (add-path only). */
    notify?: "friendship-established" | "friend-request";
    /** Status to surface in the returned UserProfile (current user's view). */
    resultStatus: RelationshipStatus;
}

/**
 * Decide the new relationship pair for an add/remove operation. Pure and total —
 * every (op, currentStatus, targetStatus) triple maps to a transition, with a
 * no-op ({ resultStatus: currentStatus }) as the default.
 */
export function decideRelationshipTransition(
    op: RelationshipOp,
    currentStatus: RelationshipStatus,
    targetStatus: RelationshipStatus,
): RelationshipTransition {
    return op === "add"
        ? decideAdd(currentStatus, targetStatus)
        : decideRemove(currentStatus, targetStatus);
}

function decideAdd(
    current: RelationshipStatus,
    target: RelationshipStatus,
): RelationshipTransition {
    // The target already has a pending request to us → accept: both become friends.
    if (target === RelationshipStatus.requested) {
        return {
            currentNext: RelationshipStatus.friend,
            targetNext: RelationshipStatus.friend,
            notify: "friendship-established",
            resultStatus: RelationshipStatus.friend,
        };
    }
    // We have no active outgoing state → send a request. Bring the other side to
    // `pending` only if it is currently `none` (leave rejected/etc. untouched).
    if (current === RelationshipStatus.none || current === RelationshipStatus.rejected) {
        return {
            currentNext: RelationshipStatus.requested,
            targetNext: target === RelationshipStatus.none ? RelationshipStatus.pending : undefined,
            notify: "friend-request",
            resultStatus: RelationshipStatus.requested,
        };
    }
    // Otherwise (already requested/pending/friend) → no change.
    return { resultStatus: current };
}

function decideRemove(
    current: RelationshipStatus,
    target: RelationshipStatus,
): RelationshipTransition {
    // Withdraw / decline an outgoing-or-incoming request we hold as `requested`.
    if (current === RelationshipStatus.requested) {
        return { currentNext: RelationshipStatus.rejected, resultStatus: RelationshipStatus.rejected };
    }
    // Unfriend → we go pending, they go requested.
    if (current === RelationshipStatus.friend) {
        return {
            currentNext: RelationshipStatus.pending,
            targetNext: RelationshipStatus.requested,
            resultStatus: RelationshipStatus.requested,
        };
    }
    // Clear a pending incoming request → we go none; clear their side too unless
    // they have explicitly rejected us.
    if (current === RelationshipStatus.pending) {
        return {
            currentNext: RelationshipStatus.none,
            targetNext: target !== RelationshipStatus.rejected ? RelationshipStatus.none : undefined,
            resultStatus: RelationshipStatus.none,
        };
    }
    // Otherwise → no change.
    return { resultStatus: current };
}
