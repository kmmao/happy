import { describe, expect, it } from "vitest";
import { formatActiveCwd, formatSessionCwdLabel } from "./chatHeaderActiveCwd";

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

describe("formatSessionCwdLabel", () => {
  it("returns the activeCwd-relative label when Claude moved into a subdir", () => {
    expect(
      formatSessionCwdLabel("/Users/me/proj/src/app", "/Users/me/proj"),
    ).toBe("./src/app");
  });

  it("returns the launchPath basename when activeCwd equals launchPath", () => {
    expect(
      formatSessionCwdLabel("/Users/me/gs-frontend", "/Users/me/gs-frontend"),
    ).toBe("gs-frontend");
  });

  it("returns the launchPath basename when activeCwd is missing", () => {
    expect(formatSessionCwdLabel(undefined, "/Users/me/gs-frontend")).toBe(
      "gs-frontend",
    );
  });

  it("returns the abbreviated sibling label when activeCwd is outside launchPath", () => {
    expect(
      formatSessionCwdLabel("/Users/me/other-proj/lib", "/Users/me/proj"),
    ).toBe("…/other-proj/lib");
  });

  it("falls back to activeCwd basename when launchPath is missing entirely", () => {
    expect(formatSessionCwdLabel("/etc/nginx", undefined)).toBe("nginx");
  });

  it("returns empty string when both paths are missing", () => {
    expect(formatSessionCwdLabel(undefined, undefined)).toBe("");
  });

  it("handles Windows backslash launchPath basename", () => {
    expect(
      formatSessionCwdLabel(undefined, "C:\\Users\\me\\gs-frontend"),
    ).toBe("gs-frontend");
  });

  it("handles Windows backslash activeCwd subdir", () => {
    expect(
      formatSessionCwdLabel("C:\\Users\\me\\proj\\src", "C:\\Users\\me\\proj"),
    ).toBe("./src");
  });
});
