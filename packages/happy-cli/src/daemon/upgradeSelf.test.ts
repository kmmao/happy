import { describe, expect, it, vi } from "vitest";

import { upgradeSelf } from "./upgradeSelf";

describe("upgradeSelf", () => {
  it("rejects invalid versions", async () => {
    const result = await upgradeSelf({
      targetVersion: "latest",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid version format");
  });

  it("installs the scoped package and starts a detached daemon from the installed happy binary", async () => {
    const execFile = vi.fn(async () => ({
      stdout: "installed ok",
      stderr: "",
    }));
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));

    const result = await upgradeSelf({
      targetVersion: "0.71.43",
      platform: "linux",
      env: {
        PATH: "/tmp/bin",
        CLAUDECODE: "1",
      },
      execFile,
      spawn,
      detectInstallInfo: async () => ({
        source: "npm-global",
        canSelfUpgrade: true,
      }),
    });

    expect(execFile).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "@kmmao/happy-coder@0.71.43"],
      expect.objectContaining({
        env: {
          PATH: "/tmp/bin",
        },
      }),
    );
    expect(spawn).toHaveBeenCalledWith(
      "happy",
      ["daemon", "start-sync"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
        env: {
          PATH: "/tmp/bin",
        },
      }),
    );
    expect(unref).toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      stdout: "installed ok",
      stderr: "",
      exitCode: 0,
    });
  });

  it("uses .cmd executables on windows", async () => {
    const execFile = vi.fn(async () => ({
      stdout: "",
      stderr: "",
    }));
    const spawn = vi.fn(() => ({ unref: vi.fn() }));

    await upgradeSelf({
      targetVersion: "0.71.43",
      platform: "win32",
      execFile,
      spawn,
      detectInstallInfo: async () => ({
        source: "npm-global",
        canSelfUpgrade: true,
      }),
    });

    expect(execFile).toHaveBeenCalledWith(
      "npm.cmd",
      ["install", "-g", "@kmmao/happy-coder@0.71.43"],
      expect.any(Object),
    );
    expect(spawn).toHaveBeenCalledWith(
      "happy.cmd",
      ["daemon", "start-sync"],
      expect.any(Object),
    );
  });

  it("returns a failure result when installation fails", async () => {
    const execFile = vi.fn(async () => {
      const error = new Error("npm exploded") as Error & {
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      error.stdout = "partial stdout";
      error.stderr = "partial stderr";
      error.code = 12;
      throw error;
    });

    const result = await upgradeSelf({
      targetVersion: "0.71.43",
      execFile,
      spawn: vi.fn(),
      detectInstallInfo: async () => ({
        source: "npm-global",
        canSelfUpgrade: true,
      }),
    });

    expect(result).toEqual({
      success: false,
      stdout: "partial stdout",
      stderr: "partial stderr",
      exitCode: 12,
      error: "npm exploded",
    });
  });

  it("rejects self-upgrade for local-source installs", async () => {
    const execFile = vi.fn();
    const spawn = vi.fn();

    const result = await upgradeSelf({
      targetVersion: "0.71.43",
      execFile,
      spawn,
      detectInstallInfo: async () => ({
        source: "local-source",
        canSelfUpgrade: false,
      }),
    });

    expect(execFile).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: "Self-upgrade is not available for install source: local-source",
    });
  });
});
