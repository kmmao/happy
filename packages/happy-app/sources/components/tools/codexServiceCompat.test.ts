import { describe, expect, it } from "vitest";
import { parseCodexServicePreview } from "./codexServiceCompat";

describe("parseCodexServicePreview", () => {
  it("parses model reroute messages", () => {
    expect(
      parseCodexServicePreview(
        "Codex rerouted model from gpt-5.4 to gpt-5.4-mini",
      ),
    ).toEqual({
      kind: "reroute",
      title: "Model rerouted",
      detail: "Codex rerouted model from gpt-5.4 to gpt-5.4-mini",
    });
  });

  it("parses warning messages with details", () => {
    expect(
      parseCodexServicePreview("Configuration warning\nDetail line"),
    ).toEqual({
      kind: "warning",
      title: "Configuration warning",
      detail: "Detail line",
    });
  });

  it("returns null for unrelated text", () => {
    expect(parseCodexServicePreview("plain text")).toBeNull();
  });
});
