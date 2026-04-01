import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { suggestAgentLoops, suggestionToCreateInput } from "./AgentLoopSuggestion";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("AgentLoopSuggestion", () => {
  it("suggests useful autonomous loops from repository signals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-suggest-"));
    tempDirs.push(dir);
    await mkdir(join(dir, ".github", "workflows"), { recursive: true });
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, ".github", "workflows", "ci.yml"), "name: ci\n", "utf-8");
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo", packageManager: "yarn@1.22.22" }), "utf-8");
    await writeFile(join(dir, "README.md"), "# Demo\n", "utf-8");
    await writeFile(join(dir, "Dockerfile"), "FROM node:20\n", "utf-8");
    await mkdir(join(dir, ".git"), { recursive: true });

    const suggestions = await suggestAgentLoops({ directory: dir });
    expect(suggestions.map((entry) => entry.key)).toEqual(expect.arrayContaining([
      "ci-watchdog",
      "dependency-hygiene",
      "docs-drift",
      "runtime-smoke",
      "project-guardian",
    ]));
    expect(suggestions.find((entry) => entry.key === "ci-watchdog")?.confidence).toBe("high");
    expect(suggestions.find((entry) => entry.key === "ci-watchdog")?.maxConsecutiveFailures).toBe(3);
    expect(suggestions.find((entry) => entry.key === "ci-watchdog")?.retryBackoffMs).toBe(5 * 60_000);
  });

  it("marks suggestions already configured when a matching loop exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-suggest-existing-"));
    tempDirs.push(dir);
    await mkdir(join(dir, ".github", "workflows"), { recursive: true });
    await writeFile(join(dir, ".github", "workflows", "ci.yml"), "name: ci\n", "utf-8");

    const suggestions = await suggestAgentLoops(
      { directory: dir },
      [{
        id: "loop-1",
        name: "CI Watchdog",
        prompt: "x",
        directory: dir,
        intervalMs: 600000,
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
        nextRunAt: 1,
        iteration: 0,
        continuityKey: "agent-loop:loop-1",
        agent: "claude",
        runtimeState: "idle",
        phase: "sleeping",
        phaseUpdatedAt: 1,
      }],
    );

    expect(suggestions.find((entry) => entry.key === "ci-watchdog")?.alreadyConfigured).toBe(true);
    expect(suggestions.find((entry) => entry.key === "ci-watchdog")?.existingLoopId).toBe("loop-1");
  });

  it("converts a suggestion into a loop create payload", () => {
    const input = suggestionToCreateInput({
      key: "project-guardian",
      name: "Project Guardian",
      description: "x",
      rationale: "y",
      directory: "/tmp/repo",
      intervalMs: 600000,
      agent: "claude",
      githubBridgeEnabled: true,
      goal: "goal",
      currentFocus: "focus",
      workingMemory: "memory",
      lastReflectionSummary: "reflection",
      maxConsecutiveFailures: 3,
      retryBackoffMs: 600000,
      prompt: "prompt",
      tags: ["guardian"],
      confidence: "high",
      alreadyConfigured: false,
    }, { projectId: "proj-1", runNow: true });

    expect(input.name).toBe("Project Guardian");
    expect(input.githubBridgeEnabled).toBe(true);
    expect(input.goal).toBe("goal");
    expect(input.maxConsecutiveFailures).toBe(3);
    expect(input.retryBackoffMs).toBe(600000);
    expect(input.projectId).toBe("proj-1");
    expect(input.runNow).toBe(true);
  });
});
