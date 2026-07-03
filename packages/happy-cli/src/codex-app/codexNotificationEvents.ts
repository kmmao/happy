/**
 * Codex notification event builders — the pure text/decision logic lifted out
 * of `CodexAppServerClient.handleNotification`'s 250-line switch.
 *
 * Most notification cases in that switch are tangled with instance state
 * (turnWaiters, activeTurnId, nextRequestId, lastDiffPreview) and must stay
 * there. But a handful carry the bug-prone part — assembling a user-facing
 * service message from optional fields, or deciding whether a completed turn is
 * a success or an abort. Those are pure functions of their params, so they live
 * here where they can be unit-tested without an app-server transport. The switch
 * keeps ownership of state mutation and handler emission; it just calls these to
 * compute the message/decision.
 */

/** Render one plan step ("[in_progress] Do the thing") for a plan-update message. */
export function formatPlanLine(step: {
  title?: string | null;
  step?: string | null;
  status?: string | null;
}): string {
  const text =
    (typeof step.title === "string" && step.title.trim().length > 0
      ? step.title.trim()
      : null) ??
    (typeof step.step === "string" && step.step.trim().length > 0
      ? step.step.trim()
      : null) ??
    "Untitled step";

  const status =
    typeof step.status === "string" && step.status.length > 0
      ? `[${step.status}] `
      : "";

  return `${status}${text}`;
}

/** Service-message text for a `model/rerouted` notification. */
export function buildModelReroutedMessage(
  fromModel: string | undefined,
  toModel: string | undefined,
): string {
  return toModel && fromModel
    ? `Codex rerouted model from ${fromModel} to ${toModel}`
    : "Codex rerouted the active model";
}

/** Service-message text for a `configWarning` notification. */
export function buildConfigWarningMessage(
  summary: string | undefined,
  details: string | null | undefined,
): string {
  if (details && summary) {
    return `${summary}\n${details}`;
  }
  return summary || "Codex reported a configuration warning";
}

/** Service-message text for a `turn/plan/updated` notification. */
export function buildPlanUpdateMessage(
  explanation: string | null | undefined,
  plan:
    | Array<{ title?: string | null; step?: string | null; status?: string | null }>
    | null
    | undefined,
): string {
  const lines = [
    explanation || "Plan updated",
    ...(plan || []).map((step) => formatPlanLine(step)),
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * The handler-event decision for a `turn/completed` notification: a "completed"
 * status is a success, anything else is an abort carrying a human reason (the
 * turn error message when present, else the raw status). The turn-waiter
 * resolve/reject and the activeTurnId/lastDiffPreview reset stay in the caller.
 */
export type CodexTurnCompletedOutcome =
  | { kind: "complete"; status: string }
  | { kind: "aborted"; status: string; reason: string };

export function classifyTurnCompletedOutcome(
  status: string,
  turn: { error?: { message?: unknown } } | null | undefined,
): CodexTurnCompletedOutcome {
  if (status === "completed") {
    return { kind: "complete", status };
  }
  const reason =
    typeof turn?.error?.message === "string" ? turn.error.message : status;
  return { kind: "aborted", status, reason };
}
