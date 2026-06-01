import { describe, it, expect } from "vitest";
import { foldReducerResultIntoSession } from "./sessionMessageFold";
import type { ReducerState } from "./reducer/reducer";
import type { Session } from "./storageTypes";
import type { Message } from "./typesMessage";

function makeSession(overrides: Partial<Session> = {}): Session {
    return {
        id: "s1",
        seq: 0,
        createdAt: 0,
        updatedAt: 0,
        active: true,
        ...overrides,
    } as Session;
}

// Build the minimal ReducerState shape the fold reads. Constructed inline
// (instead of createReducer()) so this test stays a leaf — importing the
// reducer's runtime would drag the whole message-processing chain in.
function makeReducerState(
    overrides: Partial<ReducerState> = {},
): ReducerState {
    return {
        toolIdToMessageId: new Map(),
        textStreamIdToMessageId: new Map(),
        sidechainToolIdToMessageId: new Map(),
        permissions: new Map(),
        localIds: new Map(),
        messageIds: new Map(),
        messages: new Map(),
        sidechains: new Map(),
        tracerState: {} as ReducerState["tracerState"],
        turnHadUsageStats: false,
        latestAgentTextTime: 0,
        backgroundTaskIdToMessageId: new Map(),
        backgroundTasks: new Map(),
        recentEventMessageTimes: new Map(),
        ...overrides,
    };
}

function userTextMessage(text: string, createdAt: number): Message {
    return {
        id: `m-${createdAt}`,
        kind: "user-text",
        text,
        createdAt,
    } as Message;
}

describe("foldReducerResultIntoSession", () => {
    it("returns the same session reference when nothing changed", () => {
        const session = makeSession();
        const result = foldReducerResultIntoSession({
            session,
            reducerState: makeReducerState(),
            messages: [],
            todos: undefined,
        });
        expect(result.session).toBe(session);
        expect(result.pinnedModelIdChanged).toBe(false);
    });

    it("passes through undefined session untouched", () => {
        const result = foldReducerResultIntoSession({
            session: undefined,
            reducerState: makeReducerState({ resolvedModelId: "claude-opus-4-7" }),
            messages: [],
            todos: undefined,
        });
        expect(result.session).toBeUndefined();
        expect(result.pinnedModelIdChanged).toBe(false);
    });

    it("copies latestUsage from reducerState as a fresh object", () => {
        const usage = {
            inputTokens: 1,
            outputTokens: 2,
            cacheCreation: 0,
            cacheRead: 0,
            contextSize: 3,
            totalInputTokens: 1,
            totalOutputTokens: 2,
            timestamp: 100,
        };
        const session = makeSession();
        const result = foldReducerResultIntoSession({
            session,
            reducerState: makeReducerState({ latestUsage: usage }),
            messages: [],
            todos: undefined,
        });
        expect(result.session).not.toBe(session);
        expect(result.session!.latestUsage).toEqual(usage);
        // Must be a copy, not the mutable reducerState reference.
        expect(result.session!.latestUsage).not.toBe(usage);
    });

    it("derives pinnedModelId from resolvedModelId and flags the change", () => {
        const session = makeSession({ pinnedModelId: null });
        const result = foldReducerResultIntoSession({
            session,
            reducerState: makeReducerState({ resolvedModelId: "claude-opus-4-7" }),
            messages: [],
            todos: undefined,
        });
        expect(result.session!.resolvedModelId).toBe("claude-opus-4-7");
        expect(result.session!.pinnedModelId).toBe("claude-opus-4-7");
        expect(result.pinnedModelIdChanged).toBe(true);
    });

    it("keeps an existing pin and does not flag a change", () => {
        const session = makeSession({ pinnedModelId: "claude-sonnet-4-6" });
        const result = foldReducerResultIntoSession({
            session,
            reducerState: makeReducerState({ resolvedModelId: "claude-opus-4-7" }),
            messages: [],
            todos: undefined,
        });
        // Existing pin wins over the resolved model.
        expect(result.session!.pinnedModelId).toBe("claude-sonnet-4-6");
        expect(result.pinnedModelIdChanged).toBe(false);
    });

    it("folds todos only when provided", () => {
        const todos = [
            { content: "do", status: "pending" as const, priority: "high" as const, id: "t1" },
        ];
        const session = makeSession();
        const withTodos = foldReducerResultIntoSession({
            session,
            reducerState: makeReducerState(),
            messages: [],
            todos,
        });
        expect(withTodos.session).not.toBe(session);
        expect(withTodos.session!.todos).toEqual(todos);

        const withoutTodos = foldReducerResultIntoSession({
            session,
            reducerState: makeReducerState(),
            messages: [],
            todos: undefined,
        });
        expect(withoutTodos.session).toBe(session);
    });

    it("updates latestUserRequestPreview from the newest user-text message", () => {
        const session = makeSession();
        const result = foldReducerResultIntoSession({
            session,
            reducerState: makeReducerState(),
            messages: [userTextMessage("hello", 10)],
            todos: undefined,
        });
        expect(result.session).not.toBe(session);
        expect(result.session!.latestUserRequestPreview?.text).toBe("hello");
    });

    it("keeps the previous preview when the window has no user-text", () => {
        const previous = {
            text: "earlier",
            isAutoOptionSend: false,
        };
        const session = makeSession({ latestUserRequestPreview: previous });
        const result = foldReducerResultIntoSession({
            session,
            reducerState: makeReducerState(),
            messages: [],
            todos: undefined,
        });
        // No user-text and no other side-product → same reference.
        expect(result.session).toBe(session);
    });
});
