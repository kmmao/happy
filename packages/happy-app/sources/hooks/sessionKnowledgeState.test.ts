import { describe, expect, it } from "vitest";
import {
    shouldApplyKnowledgeRequestResult,
    shouldResetSessionKnowledgeState,
} from "./sessionKnowledgeState";

describe("shouldResetSessionKnowledgeState", () => {
    it("resets when project or session becomes unavailable", () => {
        expect(
            shouldResetSessionKnowledgeState({
                projectServerId: undefined,
                sessionId: "session-1",
            }),
        ).toBe(true);

        expect(
            shouldResetSessionKnowledgeState({
                projectServerId: "project-1",
                sessionId: undefined,
            }),
        ).toBe(true);
    });

    it("does not reset while both ids remain available", () => {
        expect(
            shouldResetSessionKnowledgeState({
                projectServerId: "project-1",
                sessionId: "session-1",
            }),
        ).toBe(false);
    });
});

describe("shouldApplyKnowledgeRequestResult", () => {
    it("applies only the latest async response", () => {
        expect(
            shouldApplyKnowledgeRequestResult({
                requestToken: 2,
                latestRequestToken: 3,
            }),
        ).toBe(false);

        expect(
            shouldApplyKnowledgeRequestResult({
                requestToken: 3,
                latestRequestToken: 3,
            }),
        ).toBe(true);
    });
});
