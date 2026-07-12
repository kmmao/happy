import { describe, it, expect } from "vitest";
import { parseWorkflowJs } from "./parseWorkflowJs";

// Mirrors the CLI serializer output shape (const WORKFLOW = <json>;).
const SAMPLE = `// Happy Dynamic Workflow — generated, deterministic replay.
'use strict';

const WORKFLOW = {
  "id": "wf_123",
  "goal": "Build a settings page",
  "createdAt": 0,
  "steps": [
    { "id": "fe", "role": "frontend", "prompt": "Build UI", "model": "haiku", "order": 0 },
    { "id": "be", "role": "backend", "prompt": "Add model", "order": 0 }
  ]
};

module.exports = { WORKFLOW };
`;

describe("parseWorkflowJs", () => {
    it("recovers the workflow definition from a replay script", () => {
        const wf = parseWorkflowJs(SAMPLE);
        expect(wf?.id).toBe("wf_123");
        expect(wf?.goal).toBe("Build a settings page");
        expect(wf?.steps).toHaveLength(2);
        expect(wf?.steps[0]).toMatchObject({ role: "frontend", model: "haiku", order: 0 });
    });

    it("returns null for unrelated files", () => {
        expect(parseWorkflowJs("console.log('hi')")).toBeNull();
        expect(parseWorkflowJs("const WORKFLOW = not json;")).toBeNull();
    });
});
