import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentLoopBootstrapPlan, discoverLocalGitRepos } from "./AgentLoopBootstrap";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("AgentLoopBootstrap", () => {
  it("discovers git repositories under a root", async () => {
    const root = await mkdtemp(join(tmpdir(), "happy-loop-bootstrap-"));
    tempDirs.push(root);
    await mkdir(join(root, "repo-a", ".git"), { recursive: true });
    await mkdir(join(root, "group", "repo-b", ".git"), { recursive: true });
    await mkdir(join(root, "node_modules", "ignored", ".git"), { recursive: true });

    const repos = await discoverLocalGitRepos({ root, maxDepth: 3, limit: 10 });
    expect(repos.map((entry) => entry.name)).toEqual(["repo-b", "repo-a"]);
  });

  it("builds bootstrap plans with suggestions", async () => {
    const root = await mkdtemp(join(tmpdir(), "happy-loop-bootstrap-plan-"));
    tempDirs.push(root);
    const repo = join(root, "repo-a");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(join(repo, ".github", "workflows"), { recursive: true });
    await writeFile(join(repo, ".github", "workflows", "ci.yml"), "name: ci\n", "utf-8");
    await writeFile(join(repo, "package.json"), JSON.stringify({ name: "demo" }), "utf-8");

    const plans = await buildAgentLoopBootstrapPlan({ root, maxDepth: 2, limit: 10 });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.repo.directory).toBe(repo);
    expect(plans[0]?.suggestions.some((entry) => entry.key === "ci-watchdog")).toBe(true);
  });
});
