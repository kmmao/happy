import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NormalizedMessage } from "./typesRaw";

/**
 * `detectNeedsAttention` runs after every turn end to decide whether the App
 * should flag a session for the user. It reads from the storage singleton and
 * walks several fallbacks in a fixed priority order; a regression that reorders
 * or drops a branch would silently change which sessions light up. These tests
 * pin the heuristic (`textNeedsAttention`) and the priority ladder.
 *
 * `./storage` is mocked so the test stays a leaf — importing the real store's
 * runtime drags the whole message-processing chain in (same reason
 * `sessionMessageFold.test.ts` avoids it).
 */

// Mutable state the mocked storage.getState() returns; reset in beforeEach.
const state = vi.hoisted(() => ({
    value: {
        sessionPromptSuggestions: {} as Record<string, string | null>,
        sessionNeedsContinue: {} as Record<string, boolean>,
        sessionMessages: {} as Record<string, any>,
    },
}));

vi.mock("./storage", () => ({
    storage: { getState: () => state.value },
}));

import { detectNeedsAttention, textNeedsAttention } from "./syncHelpers";

const SID = "session-1";

/** Minimal stored message — only the fields the walker reads. */
function agentText(text: string, isThinking = false) {
    return { kind: "agent-text", isThinking, text } as any;
}
function userText(text = "hi") {
    return { kind: "user-text", text } as any;
}

function incomingAgent(...texts: string[]): NormalizedMessage {
    return {
        role: "agent",
        content: texts.map((text) => ({ type: "text", text })),
    } as any;
}

beforeEach(() => {
    state.value = {
        sessionPromptSuggestions: {},
        sessionNeedsContinue: {},
        sessionMessages: {},
    };
});

describe("textNeedsAttention", () => {
    it("flags an <options> block", () => {
        expect(textNeedsAttention("pick one\n<options>...</options>")).toBe(true);
    });

    it("flags a trailing question mark (ASCII and fullwidth)", () => {
        expect(textNeedsAttention("what next?")).toBe(true);
        expect(textNeedsAttention("下一步？")).toBe(true);
    });

    it("ignores a question mark that is not on the last line", () => {
        expect(textNeedsAttention("is this ok?\nyes, done.")).toBe(false);
    });

    it("does not flag a plain statement", () => {
        expect(textNeedsAttention("done, all tests pass.")).toBe(false);
    });

    it("trims trailing whitespace before inspecting the last line", () => {
        expect(textNeedsAttention("continue?  \n\n")).toBe(true);
    });
});

describe("detectNeedsAttention priority ladder", () => {
    it("returns true when the CLI sent a prompt suggestion (highest priority)", () => {
        // Even with a non-questioning incoming message, the suggestion wins.
        state.value.sessionPromptSuggestions = { [SID]: "try this" };
        expect(detectNeedsAttention(SID, incomingAgent("all done."))).toBe(true);
    });

    it("returns true on the needs-continue signal", () => {
        state.value.sessionNeedsContinue = { [SID]: true };
        expect(detectNeedsAttention(SID, incomingAgent("all done."))).toBe(true);
    });

    it("uses the incoming message before consulting storage", () => {
        // Storage says "no question" but the just-received message asks one.
        state.value.sessionMessages = { [SID]: { messages: [agentText("done.")] } };
        expect(detectNeedsAttention(SID, incomingAgent("what now?"))).toBe(true);
    });

    it("inspects the LAST text block of the incoming message", () => {
        expect(
            detectNeedsAttention(SID, incomingAgent("question? ", "final statement.")),
        ).toBe(false);
    });

    it("falls back to the newest stored agent-text when no incoming message", () => {
        state.value.sessionMessages = {
            [SID]: { messages: [agentText("anything else?")] },
        };
        expect(detectNeedsAttention(SID, null)).toBe(true);
    });

    it("skips thinking blocks when walking stored messages", () => {
        state.value.sessionMessages = {
            [SID]: {
                messages: [
                    agentText("hmm let me think?", true), // thinking, skipped
                    agentText("here is the result."),
                ],
            },
        };
        expect(detectNeedsAttention(SID, null)).toBe(false);
    });

    it("stops at the previous user message", () => {
        state.value.sessionMessages = {
            [SID]: {
                messages: [
                    userText("please continue"),
                    agentText("earlier question?"), // behind the user msg, not reached
                ],
            },
        };
        expect(detectNeedsAttention(SID, null)).toBe(true); // no agent-text before user -> conservative
    });

    it("is conservative (true) when no messages are loaded", () => {
        expect(detectNeedsAttention(SID, null)).toBe(true);
    });
});
