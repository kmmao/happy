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

  it("adds stack-specific suggestions when ecosystem markers exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-agent-loop-suggest-stacks-"));
    tempDirs.push(dir);
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(join(dir, "go.mod"), "module example.com/demo\n\ngo 1.22\n", "utf-8");
    await writeFile(join(dir, "Cargo.toml"), '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n', "utf-8");
    await writeFile(join(dir, "pyproject.toml"), "[project]\nname = \"demo\"\nversion = \"0.1.0\"\n", "utf-8");
    await writeFile(join(dir, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion></project>\n", "utf-8");
    await writeFile(join(dir, "main.tf"), 'terraform {\n  required_version = ">= 1.0"\n}\n', "utf-8");
    await writeFile(join(dir, "Package.swift"), "// swift-tools-version: 5.9\nimport PackageDescription\n", "utf-8");
    await writeFile(join(dir, "Makefile"), "build:\n\t@echo ok\n", "utf-8");

    const suggestions = await suggestAgentLoops({ directory: dir });
    expect(suggestions.map((s) => s.key)).toEqual(
      expect.arrayContaining([
        "go-module-steward",
        "rust-crate-health",
        "python-packaging",
        "jvm-build-hygiene",
        "terraform-watch",
        "swift-package-health",
        "makefile-pipeline",
        "project-guardian",
      ]),
    );
  });

  it("detects Ruby, .NET, Flutter, Helm, Vue, uni-app, Taro, and WeChat markers", async () => {
    const base = await mkdtemp(join(tmpdir(), "happy-agent-loop-eco-"));
    tempDirs.push(base);

    const ruby = join(base, "ruby");
    await mkdir(join(ruby, ".git"), { recursive: true });
    await writeFile(join(ruby, "Gemfile"), "source \"https://rubygems.org\"\n", "utf-8");
    expect((await suggestAgentLoops({ directory: ruby })).map((s) => s.key)).toEqual(
      expect.arrayContaining(["ruby-bundle-steward", "project-guardian"]),
    );

    const dotnet = join(base, "dotnet");
    await mkdir(join(dotnet, ".git"), { recursive: true });
    await writeFile(join(dotnet, "App.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>\n", "utf-8");
    expect((await suggestAgentLoops({ directory: dotnet })).map((s) => s.key)).toEqual(
      expect.arrayContaining(["dotnet-build-health", "project-guardian"]),
    );

    const flutter = join(base, "flutter");
    await mkdir(join(flutter, ".git"), { recursive: true });
    await writeFile(
      join(flutter, "pubspec.yaml"),
      "name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n",
      "utf-8",
    );
    expect((await suggestAgentLoops({ directory: flutter })).map((s) => s.key)).toEqual(
      expect.arrayContaining(["flutter-app-health", "project-guardian"]),
    );

    const helm = join(base, "helm");
    await mkdir(join(helm, ".git"), { recursive: true });
    await writeFile(join(helm, "Chart.yaml"), "apiVersion: v2\nname: demo\nversion: 0.1.0\n", "utf-8");
    expect((await suggestAgentLoops({ directory: helm })).map((s) => s.key)).toEqual(
      expect.arrayContaining(["helm-chart-watch", "project-guardian"]),
    );

    const vue = join(base, "vue");
    await mkdir(join(vue, ".git"), { recursive: true });
    await writeFile(join(vue, "vue.config.js"), "module.exports = {}\n", "utf-8");
    await writeFile(join(vue, "package.json"), JSON.stringify({ name: "demo", dependencies: { vue: "^3.4.0" } }), "utf-8");
    expect((await suggestAgentLoops({ directory: vue })).map((s) => s.key)).toEqual(
      expect.arrayContaining(["vue-frontend-steward", "dependency-hygiene", "project-guardian"]),
    );

    const uni = join(base, "uni");
    await mkdir(join(uni, ".git"), { recursive: true });
    await writeFile(join(uni, "pages.json"), "{}\n", "utf-8");
    await writeFile(join(uni, "manifest.json"), "{}\n", "utf-8");
    expect((await suggestAgentLoops({ directory: uni })).map((s) => s.key)).toEqual(
      expect.arrayContaining(["uniapp-hybrid", "project-guardian"]),
    );

    const taro = join(base, "taro");
    await mkdir(join(taro, ".git"), { recursive: true });
    await writeFile(
      join(taro, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { "@tarojs/taro": "4.0.0" } }),
      "utf-8",
    );
    expect((await suggestAgentLoops({ directory: taro })).map((s) => s.key)).toEqual(
      expect.arrayContaining(["taro-cross-end", "dependency-hygiene", "project-guardian"]),
    );

    const mp = join(base, "wechat-mp");
    await mkdir(join(mp, ".git"), { recursive: true });
    await writeFile(join(mp, "package.json"), "{}", "utf-8");
    await writeFile(join(mp, "project.config.json"), "{ \"miniprogramRoot\": \"./\" }\n", "utf-8");
    expect((await suggestAgentLoops({ directory: mp })).map((s) => s.key)).toEqual(
      expect.arrayContaining(["wechat-miniprogram", "project-guardian"]),
    );

    const umiApp = join(base, "umi");
    await mkdir(join(umiApp, ".git"), { recursive: true });
    await writeFile(join(umiApp, "package.json"), JSON.stringify({ name: "demo", dependencies: { umi: "4.2.0" } }), "utf-8");
    expect((await suggestAgentLoops({ directory: umiApp })).map((s) => s.key)).toEqual(
      expect.arrayContaining(["umi-framework-steward", "dependency-hygiene", "project-guardian"]),
    );
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
