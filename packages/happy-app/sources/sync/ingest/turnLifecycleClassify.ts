/**
 * Turn lifecycle classification — the pure core lifted out of `ingestNewMessage`.
 *
 * A single decrypted SessionMessage can announce that a Turn (CONTEXT.md: Turn)
 * just started or just ended. Which one — and whether it says anything at all —
 * is decided by four independent signal sources that vary by Provider
 * (CONTEXT.md: Provider):
 *
 *   - Codex / ACP:  `content.data.type` ∈ { task_started, task_complete, turn_aborted }
 *   - session:      `content.data.ev.t` ∈ { turn-start, turn-end }
 *   - session-proto: top-level `role === "session"` + `content.ev.t` ∈ { turn-start, turn-end }
 *
 * Before this seam existed the boolean tangle sat inline in `ingestNewMessage`
 * with no test coverage, so a regression in any one Provider's shape (a renamed
 * discriminator, a new `role`) would silently stop flipping the App's thinking
 * state. Extracting it makes the classification the interface-as-test-surface:
 * pure in → typed out, exhaustively pinned by `turnLifecycleClassify.test.ts`.
 * The storage mutations that REACT to the verdict stay in `ingestNewMessage`.
 */

/**
 * The loosely-typed shape `ingestNewMessage` sees after decrypt. Every field is
 * optional because the four Provider stream formats each populate a different
 * subset; the classifier reads them defensively.
 */
export type RawLifecycleContent = {
    role?: string;
    content?: {
        type?: string;
        data?: { type?: string; ev?: { t?: string } };
        ev?: { t?: string };
    };
} | null | undefined;

export type TurnLifecycleVerdict = {
    /** A Turn just started — the session should flip to `thinking`. */
    isTaskStarted: boolean;
    /** A Turn just ended — the session should flip out of `thinking`. */
    isTaskComplete: boolean;
};

/**
 * Classify one decrypted message's turn-lifecycle signal. Pure and total:
 * returns `{ isTaskStarted: false, isTaskComplete: false }` for the (common)
 * case of a message that carries no lifecycle transition. A single message
 * never both starts and ends a Turn, but the two flags are computed
 * independently so a malformed record can't wedge the caller.
 */
export function classifyTurnLifecycle(
    rawContent: RawLifecycleContent,
): TurnLifecycleVerdict {
    const contentType = rawContent?.content?.type;
    const dataType = rawContent?.content?.data?.type;
    const sessionEventType = rawContent?.content?.data?.ev?.t;
    const envelopeEventType = rawContent?.content?.ev?.t;
    const isSessionProtocolEvent = rawContent?.role === "session";

    const isTaskComplete =
        ((contentType === "acp" || contentType === "codex") &&
            (dataType === "task_complete" || dataType === "turn_aborted")) ||
        (contentType === "session" && sessionEventType === "turn-end") ||
        (isSessionProtocolEvent && envelopeEventType === "turn-end");

    const isTaskStarted =
        ((contentType === "acp" || contentType === "codex") &&
            dataType === "task_started") ||
        (contentType === "session" && sessionEventType === "turn-start") ||
        (isSessionProtocolEvent && envelopeEventType === "turn-start");

    return { isTaskStarted, isTaskComplete };
}
