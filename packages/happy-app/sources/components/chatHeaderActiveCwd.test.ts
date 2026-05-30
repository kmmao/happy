import { describe, expect, it } from "vitest";
import { formatActiveCwd } from "./chatHeaderActiveCwd";

describe("formatActiveCwd", () => {
  it("returns empty string when activeCwd matches launchPath (header suppresses the row)", () => {
    expect(formatActiveCwd("/Users/me/proj", "/Users/me/proj")).toBe("");
  });

  it("returns empty string when activeCwd is empty (no live cwd yet)", () => {
    expect(formatActiveCwd("", "/Users/me/proj")).toBe("");
  });

  it("renders subdirectory of launchPath as ./relative", () => {
    expect(formatActiveCwd("/Users/me/proj/src/app", "/Users/me/proj")).toBe(
      "./src/app",
    );
  });

  it("renders direct child of launchPath as ./<child>", () => {
    expect(formatActiveCwd("/Users/me/proj/src", "/Users/me/proj")).toBe(
      "./src",
    );
  });

  it("abbreviates a sibling tree to …/parent/name", () => {
    expect(formatActiveCwd("/Users/me/other-proj/lib", "/Users/me/proj")).toBe(
      "…/other-proj/lib",
    );
  });

  it("returns verbatim when there is no parent context to abbreviate", () => {
    expect(formatActiveCwd("/etc", undefined)).toBe("/etc");
  });

  it("handles Windows backslash paths under launchPath", () => {
    expect(
      formatActiveCwd("C:\\Users\\me\\proj\\src", "C:\\Users\\me\\proj"),
    ).toBe("./src");
  });

  it("handles Windows backslash paths outside launchPath (sibling)", () => {
    expect(
      formatActiveCwd("C:\\Users\\me\\elsewhere\\bin", "C:\\Users\\me\\proj"),
    ).toBe("…\\elsewhere\\bin");
  });

  it("does not treat a launchPath-prefix match as inside (boundary safety)", () => {
    // "/Users/me/projx" should NOT be reported as inside "/Users/me/proj".
    // Without the explicit separator check it would slice "x" → "./x".
    expect(formatActiveCwd("/Users/me/projx/src", "/Users/me/proj")).toBe(
      "…/projx/src",
    );
  });

  it("falls back gracefully when launchPath is undefined and path is deep", () => {
    expect(formatActiveCwd("/Users/me/proj/src/app", undefined)).toBe(
      "…/src/app",
    );
  });
});
