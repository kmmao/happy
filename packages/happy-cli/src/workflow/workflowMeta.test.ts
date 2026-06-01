import { describe, expect, it } from "vitest";

import { parseWorkflowMeta } from "./workflowMeta";

describe("parseWorkflowMeta", () => {
  it("extracts name and description from a script's meta literal", () => {
    const script = [
      "export const meta = {",
      "  name: 'verify-ui-packages',",
      "  description: '并行验证 happy-app 与 happy-codium 两个 UI 包',",
      "  phases: [{ title: 'Verify' }],",
      "}",
      "phase('Verify')",
      "await agent('check things')",
    ].join("\n");
    expect(parseWorkflowMeta({ script })).toEqual({
      name: "verify-ui-packages",
      description: "并行验证 happy-app 与 happy-codium 两个 UI 包",
    });
  });

  it("handles double-quoted meta fields", () => {
    const script = 'export const meta = { name: "spec", description: "Build a spec" }';
    expect(parseWorkflowMeta({ script })).toEqual({
      name: "spec",
      description: "Build a spec",
    });
  });

  it("handles escaped quotes inside values", () => {
    const script = "export const meta = { name: 'a\\'b', description: 'it\\'s fine' }";
    expect(parseWorkflowMeta({ script })).toEqual({
      name: "a'b",
      description: "it's fine",
    });
  });

  it("does not match name/description in the script body outside meta", () => {
    const script = [
      "export const meta = { name: 'real-name', description: 'real-desc' }",
      "const x = { name: 'decoy', description: 'decoy-desc' }",
    ].join("\n");
    expect(parseWorkflowMeta({ script }).name).toBe("real-name");
  });

  it("falls back to empty strings when meta is missing", () => {
    expect(parseWorkflowMeta({ script: "phase('x')" })).toEqual({
      name: "",
      description: "",
    });
  });

  it("uses the name for a predefined workflow invoked by name", () => {
    expect(parseWorkflowMeta({ name: "audit-workflow-feature" })).toEqual({
      name: "audit-workflow-feature",
      description: "",
    });
  });

  it("returns empty for non-object / missing input", () => {
    expect(parseWorkflowMeta(undefined)).toEqual({ name: "", description: "" });
    expect(parseWorkflowMeta("nope")).toEqual({ name: "", description: "" });
    expect(parseWorkflowMeta({})).toEqual({ name: "", description: "" });
  });
});
