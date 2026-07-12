import { describe, it, expect } from "vitest";
import { parseWorkflowRunJson } from "./parseWorkflowRunJson";

const RUN = {
    definition: {
        id: "wf_1",
        goal: "Build it",
        createdAt: 0,
        steps: [{ id: "a", role: "frontend", prompt: "p", order: 0 }],
    },
    status: "running",
    steps: { a: "running" },
    updatedAt: 5,
};

describe("parseWorkflowRunJson", () => {
    it("parses a valid run-state file", () => {
        const run = parseWorkflowRunJson(JSON.stringify(RUN));
        expect(run?.status).toBe("running");
        expect(run?.steps.a).toBe("running");
        expect(run?.definition.goal).toBe("Build it");
    });

    it("returns null on malformed or invalid content", () => {
        expect(parseWorkflowRunJson("not json")).toBeNull();
        expect(parseWorkflowRunJson(JSON.stringify({ status: "nope" }))).toBeNull();
    });
});
