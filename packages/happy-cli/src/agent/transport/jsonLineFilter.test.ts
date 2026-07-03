import { describe, expect, it } from "vitest";
import { validateJsonLine } from "./jsonLineFilter";

describe("validateJsonLine", () => {
  it("keeps a JSON object line, returning the original untrimmed line", () => {
    const line = '  {"jsonrpc":"2.0","id":1}  ';
    expect(validateJsonLine(line)).toBe(line);
  });

  it("keeps a JSON array line (batched requests)", () => {
    expect(validateJsonLine('[{"a":1}]')).toBe('[{"a":1}]');
  });

  it("drops empty / whitespace-only lines", () => {
    expect(validateJsonLine("")).toBeNull();
    expect(validateJsonLine("   ")).toBeNull();
  });

  it("drops lines that do not start with { or [", () => {
    expect(validateJsonLine("DEBUG starting up")).toBeNull();
    expect(validateJsonLine("2026-07-03 tracing span")).toBeNull();
  });

  it("drops a bare number even though it is valid JSON (not JSON-RPC)", () => {
    // Regression: primitives like a lone request id must not be forwarded.
    expect(validateJsonLine("105887304")).toBeNull();
  });

  it("drops unparseable would-be JSON", () => {
    expect(validateJsonLine("{not valid json")).toBeNull();
  });
});
