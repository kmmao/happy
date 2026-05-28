import type { Session, SessionLatestUserRequestPreview } from "./storageTypes";
import type { ReducerResult, ReducerState } from "./reducer/reducer";
import type { Message } from "./typesMessage";
import { getLatestUserRequestPreview } from "@/utils/latestUserRequestPreview";

/**
 * Derives the latest user request preview for a session, falling back to the
 * previously known value when the current message window has no user message.
 */
export function resolveLatestUserRequestPreview(
    messages: readonly Message[],
    fallback?: SessionLatestUserRequestPreview | null,
): SessionLatestUserRequestPreview | null {
    return getLatestUserRequestPreview(messages) ?? fallback ?? null;
}

export interface FoldReducerResultInput {
    /** Current session, or undefined when the session row isn't loaded yet. */
    session: Session | undefined;
    /**
     * Reducer state after a pass — the source of the side-products folded back
     * onto the Session (latestUsage, resolvedModelId, and from it pinnedModelId).
     */
    reducerState: ReducerState;
    /**
     * Merged message list (newest-first) used to derive the latest user request
     * preview. Pass the post-merge array so the preview reflects what the UI shows.
     */
    messages: readonly Message[];
    /**
     * Todos from this reducer pass, or `undefined` to leave `session.todos`
     * untouched. Callers that did not run a todo-producing pass pass `undefined`.
     */
    todos: ReducerResult["todos"];
}

export interface FoldedSession {
    /** Next session — the SAME reference as `input.session` when nothing changed. */
    session: Session | undefined;
    /** True when pinnedModelId was (re)derived from the reducer's resolvedModelId. */
    pinnedModelIdChanged: boolean;
}

/**
 * Folds the reducer's per-session side-products (todos, latestUsage,
 * resolvedModelId, pinnedModelId, latestUserRequestPreview) back onto the
 * Session object.
 *
 * This is the single rule that the message-ingest paths in storage.ts used to
 * hand-write — and had already drifted on (each `set()` closure folded a
 * different subset). Concentrating it here keeps the fold consistent and makes
 * the rule testable in isolation, the way `mergeProcessedMessages` did for the
 * ordering layer one level below.
 *
 * Invariants the callers rely on:
 *  - Pure: no `set()`, no LRU, no persistence, no preferences-sync side-effects.
 *    The store keeps those in its orchestration layer.
 *  - Reference-stable: returns the **same** `session` reference when no field
 *    changed, so useSyncExternalStore selectors stay stable and the store can
 *    skip rebuilding `sessionListViewData`.
 *  - `pinnedModelIdChanged` reports whether the pin moved; the caller decides
 *    whether to stage/sync the change (server-refresh paths intentionally don't).
 */
export function foldReducerResultIntoSession(
    input: FoldReducerResultInput,
): FoldedSession {
    const { session, reducerState, messages, todos } = input;
    if (!session) {
        return { session, pinnedModelIdChanged: false };
    }

    const latestUserRequestPreview = resolveLatestUserRequestPreview(
        messages,
        session.latestUserRequestPreview,
    );

    // Only allocate a new Session when the reducer actually produced something
    // worth folding. Returning the same reference otherwise is what keeps the
    // store from rebuilding the list view on no-op streaming updates.
    const needsUpdate =
        todos !== undefined ||
        !!reducerState.latestUsage ||
        !!reducerState.resolvedModelId ||
        latestUserRequestPreview !== (session.latestUserRequestPreview ?? null);

    if (!needsUpdate) {
        return { session, pinnedModelIdChanged: false };
    }

    const nextPinnedModelId =
        session.pinnedModelId ?? reducerState.resolvedModelId ?? null;
    const pinnedModelIdChanged =
        nextPinnedModelId !== (session.pinnedModelId ?? null);

    const nextSession: Session = {
        ...session,
        ...(todos !== undefined && { todos }),
        latestUserRequestPreview,
        // Copy latestUsage out of the mutable reducerState so it's available on
        // the Session immediately, even before messages finish loading.
        latestUsage: reducerState.latestUsage
            ? { ...reducerState.latestUsage }
            : session.latestUsage,
        ...(reducerState.resolvedModelId && {
            resolvedModelId: reducerState.resolvedModelId,
        }),
        ...(nextPinnedModelId && { pinnedModelId: nextPinnedModelId }),
    };

    return { session: nextSession, pinnedModelIdChanged };
}
