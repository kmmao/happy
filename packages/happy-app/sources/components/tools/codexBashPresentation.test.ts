import { describe, expect, it } from "vitest";

import {
  formatCodexBashDescription,
  formatCodexBashTitle,
  getCodexBashIconName,
  getCodexBashMetaLabels,
} from "./codexBashPresentation";

describe("codexBashPresentation", () => {
  it("maps verify summaries to targeted labels", () => {
    const summary = {
      type: "verify" as const,
      command: "yarn workspace happy-app typecheck",
      query: null,
      resolvedPath: null,
      displayName: "happy-app",
      subType: "typecheck",
      manager: "yarn" as const,
      workspace: "happy-app",
      extraCount: 0,
    };

    expect(getCodexBashIconName(summary)).toBe("checklist");
    expect(formatCodexBashTitle(summary)).toBe("Typecheck");
    expect(formatCodexBashDescription(summary)).toBe(
      "Typecheck · happy-app",
    );
    expect(getCodexBashMetaLabels(summary)).toEqual(["yarn", "happy-app"]);
  });

  it("maps test summaries to targeted labels", () => {
    const summary = {
      type: "test" as const,
      command: "vitest --run foo.test.ts",
      query: null,
      resolvedPath: null,
      displayName: "vitest",
      runner: "vitest" as const,
      extraCount: 0,
    };

    expect(getCodexBashIconName(summary)).toBe("beaker");
    expect(formatCodexBashTitle(summary)).toBe("Tests");
    expect(formatCodexBashDescription(summary)).toBe("Vitest tests");
    expect(getCodexBashMetaLabels(summary)).toEqual(["vitest"]);
  });

  it("maps git summaries to targeted labels", () => {
    const summary = {
      type: "git" as const,
      command: "git diff -- file.ts",
      query: null,
      resolvedPath: null,
      displayName: "diff",
      subType: "diff",
      extraCount: 0,
    };

    expect(getCodexBashIconName(summary)).toBe("git-branch");
    expect(formatCodexBashTitle(summary)).toBe("Git");
    expect(formatCodexBashDescription(summary)).toBe("Git diff");
    expect(getCodexBashMetaLabels(summary)).toEqual(["diff"]);
  });

  it("maps package and run summaries to targeted labels", () => {
    const packageSummary = {
      type: "package" as const,
      command: "npm install zod",
      query: null,
      resolvedPath: null,
      displayName: "install",
      subType: "install",
      manager: "npm" as const,
      extraCount: 0,
    };
    const runSummary = {
      type: "run" as const,
      command: "expo start",
      query: null,
      resolvedPath: null,
      displayName: "start",
      subType: "start",
      extraCount: 0,
    };

    expect(getCodexBashIconName(packageSummary)).toBe("package");
    expect(formatCodexBashTitle(packageSummary)).toBe("Install");
    expect(formatCodexBashDescription(packageSummary)).toBe("Npm Install");
    expect(getCodexBashMetaLabels(packageSummary)).toEqual(["npm"]);

    expect(getCodexBashIconName(runSummary)).toBe("play");
    expect(formatCodexBashTitle(runSummary)).toBe("Start");
    expect(formatCodexBashDescription(runSummary)).toBe("Run start");
  });
});
