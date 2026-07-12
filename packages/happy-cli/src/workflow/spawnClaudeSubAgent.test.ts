import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowStep } from "@kmmao/happy-wire";
import {
  buildSubAgentCommand,
  makeClaudeSubAgentExecutor,
  type CommandRunner,
} from "./spawnClaudeSubAgent";

const step: WorkflowStep = {
  id: "s1",
  role: "frontend",
  prompt: "Build the settings screen",
  model: "claude-haiku-4-5-20251001",
  order: 0,
};

describe("buildSubAgentCommand", () => {
  it("builds a headless claude -p command with model", () => {
    const cmd = buildSubAgentCommand(step, { cwd: "/repo" });
    expect(cmd.file).toBe("claude");
    expect(cmd.args).toEqual([
      "-p",
      "Build the settings screen",
      "--output-format",
      "text",
      "--model",
      "claude-haiku-4-5-20251001",
    ]);
  });

  it("omits --model when the step has none and honors claudeBin", () => {
    const cmd = buildSubAgentCommand(
      { ...step, model: undefined },
      { cwd: "/repo", claudeBin: "/usr/local/bin/claude" },
    );
    expect(cmd.file).toBe("/usr/local/bin/claude");
    expect(cmd.args).not.toContain("--model");
  });
});

describe("makeClaudeSubAgentExecutor", () => {
  it("maps a successful run to an ok result with trimmed output", async () => {
    const runner: CommandRunner = async () => ({ stdout: "  done\n", stderr: "", exitCode: 0 });
    const exec = makeClaudeSubAgentExecutor({ cwd: "/repo" }, runner);
    const r = await exec(step);
    expect(r).toEqual({ stepId: "s1", role: "frontend", ok: true, output: "done", error: undefined });
  });

  it("maps a failed run to ok:false with an error", async () => {
    const runner: CommandRunner = async () => ({ stdout: "", stderr: "boom", exitCode: 2 });
    const exec = makeClaudeSubAgentExecutor({ cwd: "/repo" }, runner);
    const r = await exec(step);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
  });

  it("passes cwd and a timeout to the runner", async () => {
    let seen: { cwd: string; timeoutMs: number } | null = null;
    const runner: CommandRunner = async (_cmd, opts) => {
      seen = opts;
      return { stdout: "ok", stderr: "", exitCode: 0 };
    };
    await makeClaudeSubAgentExecutor({ cwd: "/repo", timeoutMs: 1234 }, runner)(step);
    expect(seen).toEqual({ cwd: "/repo", timeoutMs: 1234 });
  });

  it("isolation runs the step in its own worktree/branch", async () => {
    const repo = await mkdtemp(join(tmpdir(), "wf-iso-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    git("init", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    await writeFile(join(repo, "README.md"), "x");
    git("add", ".");
    git("commit", "-m", "init");

    let ranCwd = "";
    const branches: string[] = [];
    const runner: CommandRunner = async (_cmd, opts) => {
      ranCwd = opts.cwd;
      return { stdout: "ok", stderr: "", exitCode: 0 };
    };
    const exec = makeClaudeSubAgentExecutor(
      { cwd: repo, isolation: true, workflowId: "wf_iso" },
      runner,
      { onBranch: (_id, b) => branches.push(b) },
    );

    const r = await exec(step);
    expect(r.ok).toBe(true);
    expect(r.branch).toBeTruthy();
    expect(branches).toHaveLength(1);
    // The sub-agent ran in the isolated worktree, not the repo root.
    expect(ranCwd).not.toBe(repo);
    expect(ranCwd).toContain(".dev/worktree");

    await rm(repo, { recursive: true, force: true });
  });
});
