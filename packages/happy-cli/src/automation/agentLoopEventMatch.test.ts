import { describe, it, expect } from "vitest";
import { evaluateLoopEventFilters } from "./agentLoopEventMatch";
import type { AgentLoopDefinition, AgentLoopEvent } from "./AgentLoopStore";

type Filters = Pick<AgentLoopDefinition, "eventSourceAllowlist" | "eventKeywordFilters">;
type Evt = Pick<AgentLoopEvent, "source" | "title" | "details">;

const event = (over: Partial<Evt> = {}): Evt => ({
  source: "github",
  title: "Something happened",
  details: "",
  ...over,
});

describe("evaluateLoopEventFilters", () => {
  it("accepts any source when the allowlist is empty or absent", () => {
    expect(evaluateLoopEventFilters({}, event()).accepted).toBe(true);
    expect(evaluateLoopEventFilters({ eventSourceAllowlist: [] }, event()).accepted).toBe(true);
  });

  it("rejects a source outside a non-empty allowlist", () => {
    const result = evaluateLoopEventFilters({ eventSourceAllowlist: ["ci"] }, event({ source: "github" }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("github");
  });

  it("matches the allowlist case-insensitively", () => {
    expect(
      evaluateLoopEventFilters({ eventSourceAllowlist: ["GitHub"] }, event({ source: "github" })).accepted,
    ).toBe(true);
  });

  it("accepts when a keyword matches the title", () => {
    expect(
      evaluateLoopEventFilters({ eventKeywordFilters: ["deploy"] }, event({ title: "Deploy failed" })).accepted,
    ).toBe(true);
  });

  it("accepts when a keyword matches the details (not just the title)", () => {
    expect(
      evaluateLoopEventFilters(
        { eventKeywordFilters: ["rollback"] },
        event({ title: "alert", details: "please rollback now" }),
      ).accepted,
    ).toBe(true);
  });

  it("rejects when no keyword matches", () => {
    const result = evaluateLoopEventFilters(
      { eventKeywordFilters: ["deploy"] },
      event({ title: "unrelated", details: "nothing here" }),
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("keyword");
  });

  it("matches keywords as substrings (documented: 'bug' matches 'debug')", () => {
    expect(
      evaluateLoopEventFilters({ eventKeywordFilters: ["bug"] }, event({ title: "debug session" })).accepted,
    ).toBe(true);
  });

  it("enforces both allowlist AND keywords together", () => {
    const filters: Filters = { eventSourceAllowlist: ["github"], eventKeywordFilters: ["deploy"] };
    // Right source, wrong keyword → rejected on keywords.
    expect(evaluateLoopEventFilters(filters, event({ source: "github", title: "idle" })).accepted).toBe(false);
    // Right source, right keyword → accepted.
    expect(
      evaluateLoopEventFilters(filters, event({ source: "github", title: "deploy now" })).accepted,
    ).toBe(true);
  });
});
