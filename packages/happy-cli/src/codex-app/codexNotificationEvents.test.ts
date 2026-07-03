import { describe, it, expect } from "vitest";
import {
  formatPlanLine,
  buildModelReroutedMessage,
  buildConfigWarningMessage,
  buildPlanUpdateMessage,
  classifyTurnCompletedOutcome,
} from "./codexNotificationEvents";

describe("formatPlanLine", () => {
  it("prefers title, then step, then a fallback", () => {
    expect(formatPlanLine({ title: "T" })).toBe("T");
    expect(formatPlanLine({ step: "S" })).toBe("S");
    expect(formatPlanLine({})).toBe("Untitled step");
    expect(formatPlanLine({ title: "  ", step: "S" })).toBe("S");
  });

  it("prefixes a [status] when present", () => {
    expect(formatPlanLine({ title: "T", status: "in_progress" })).toBe(
      "[in_progress] T",
    );
    expect(formatPlanLine({ title: "T", status: "" })).toBe("T");
  });
});

describe("buildModelReroutedMessage", () => {
  it("names both models when both are known", () => {
    expect(buildModelReroutedMessage("a", "b")).toBe(
      "Codex rerouted model from a to b",
    );
  });
  it("falls back to a generic message when either is missing", () => {
    expect(buildModelReroutedMessage(undefined, "b")).toBe(
      "Codex rerouted the active model",
    );
    expect(buildModelReroutedMessage("a", undefined)).toBe(
      "Codex rerouted the active model",
    );
  });
});

describe("buildConfigWarningMessage", () => {
  it("joins summary + details when both present", () => {
    expect(buildConfigWarningMessage("sum", "det")).toBe("sum\ndet");
  });
  it("uses summary alone when details missing", () => {
    expect(buildConfigWarningMessage("sum", null)).toBe("sum");
    expect(buildConfigWarningMessage("sum", undefined)).toBe("sum");
  });
  it("falls back when summary missing", () => {
    expect(buildConfigWarningMessage(undefined, "det")).toBe(
      "Codex reported a configuration warning",
    );
  });
});

describe("buildPlanUpdateMessage", () => {
  it("leads with the explanation then one line per step", () => {
    expect(
      buildPlanUpdateMessage("Doing X", [
        { title: "one", status: "completed" },
        { step: "two" },
      ]),
    ).toBe("Doing X\n[completed] one\ntwo");
  });
  it("defaults the explanation and tolerates an empty plan", () => {
    expect(buildPlanUpdateMessage(null, null)).toBe("Plan updated");
    expect(buildPlanUpdateMessage(undefined, [])).toBe("Plan updated");
  });
});

describe("classifyTurnCompletedOutcome", () => {
  it("treats 'completed' as a success", () => {
    expect(classifyTurnCompletedOutcome("completed", null)).toEqual({
      kind: "complete",
      status: "completed",
    });
  });
  it("treats any other status as an abort carrying the error message", () => {
    expect(
      classifyTurnCompletedOutcome("failed", { error: { message: "boom" } }),
    ).toEqual({ kind: "aborted", status: "failed", reason: "boom" });
  });
  it("falls back to the raw status as the reason when no error message", () => {
    expect(classifyTurnCompletedOutcome("cancelled", null)).toEqual({
      kind: "aborted",
      status: "cancelled",
      reason: "cancelled",
    });
  });
});
