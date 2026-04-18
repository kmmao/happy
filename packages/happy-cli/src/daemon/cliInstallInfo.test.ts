import { describe, expect, it, vi } from "vitest";

import { detectCliInstallInfo } from "./cliInstallInfo";

describe("detectCliInstallInfo", () => {
  it("classifies installs under npm root -g as npm-global", async () => {
    const execFile = vi.fn(async () => ({
      stdout: "/usr/local/lib/node_modules\n",
      stderr: "",
    }));

    const result = await detectCliInstallInfo({
      packagePath: "/usr/local/lib/node_modules/@kmmao/happy-coder",
      execFile,
      pathExists: () => false,
    });

    expect(result).toEqual({
      source: "npm-global",
      canSelfUpgrade: true,
    });
  });

  it("classifies installs from a git checkout as local-source", async () => {
    const execFile = vi.fn(async () => ({
      stdout: "/usr/local/lib/node_modules\n",
      stderr: "",
    }));

    const result = await detectCliInstallInfo({
      packagePath: "/Users/test/dev/happy/packages/happy-cli",
      execFile,
      pathExists: (candidate) => candidate === "/Users/test/dev/happy/.git",
    });

    expect(result).toEqual({
      source: "local-source",
      canSelfUpgrade: false,
    });
  });

  it("falls back to unknown when it cannot verify npm global install or local checkout", async () => {
    const execFile = vi.fn(async () => {
      throw new Error("npm missing");
    });

    const result = await detectCliInstallInfo({
      packagePath: "/opt/happy/custom-install",
      execFile,
      pathExists: () => false,
    });

    expect(result).toEqual({
      source: "unknown",
      canSelfUpgrade: false,
    });
  });
});
