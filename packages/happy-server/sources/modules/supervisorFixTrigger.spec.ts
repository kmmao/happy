import { describe, it, expect } from "vitest";
import { buildFixActionTriggerInput } from "./supervisorFixTrigger";

const ACTION = {
    id: "act-1",
    title: "Fix the thing",
    description: "It is broken",
    suggestedFix: "Do the fix",
    category: "security",
    severity: "high",
    // extra fields on a real SupervisorAction row must NOT leak into the payload
    approval: "approved",
    fixStatus: "pending",
};

describe("buildFixActionTriggerInput", () => {
    it("projects exactly the five payload fields, dropping everything else", () => {
        expect(buildFixActionTriggerInput(ACTION)).toEqual({
            title: "Fix the thing",
            description: "It is broken",
            suggestedFix: "Do the fix",
            category: "security",
            severity: "high",
        });
    });

    it("omits issueNumber entirely when not supplied (not `undefined`)", () => {
        const payload = buildFixActionTriggerInput(ACTION);
        expect("issueNumber" in payload).toBe(false);
    });

    it("includes issueNumber only when supplied", () => {
        expect(buildFixActionTriggerInput(ACTION, 42).issueNumber).toBe(42);
    });

    it("preserves a null suggestedFix", () => {
        expect(buildFixActionTriggerInput({ ...ACTION, suggestedFix: null }).suggestedFix).toBeNull();
    });
});
