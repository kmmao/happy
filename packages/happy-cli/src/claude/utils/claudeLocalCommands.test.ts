/**
 * Tests for the Claude local slash-command scanner.
 *
 * Uses tempdir fixtures rather than env-var indirection: the production
 * code accepts explicit `cwd` and `userHome` options purely to keep the
 * tests deterministic and parallel-safe.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

import { collectClaudeLocalCommands } from "./claudeLocalCommands";

describe("collectClaudeLocalCommands", () => {
  let testRoot: string;
  let cwd: string;
  let userHome: string;

  beforeEach(() => {
    testRoot = join(
      tmpdir(),
      `claude-cmds-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    cwd = join(testRoot, "project");
    userHome = join(testRoot, "home");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(userHome, { recursive: true });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("returns an empty list when no command directories exist", async () => {
    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual([]);
    expect(result.slashCommandDescriptions).toEqual({});
  });

  it("picks up project-level commands and pulls description from frontmatter", async () => {
    const dir = join(cwd, ".claude", "commands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "deploy.md"),
      `---\ndescription: Deploy the server\n---\n\n# Deploy\n\nBody.`,
    );

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual(["deploy"]);
    expect(result.slashCommandDescriptions).toEqual({
      deploy: "Deploy the server",
    });
  });

  it("falls back to the first non-empty body line when frontmatter has no description", async () => {
    const dir = join(cwd, ".claude", "commands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "changelog.md"),
      `Update the project changelog\n\n## Usage\n\n/changelog`,
    );

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommandDescriptions.changelog).toBe(
      "Update the project changelog",
    );
  });

  it("merges user-level commands with project-level ones", async () => {
    mkdirSync(join(cwd, ".claude", "commands"), { recursive: true });
    mkdirSync(join(userHome, ".claude", "commands"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "commands", "deploy.md"),
      `Deploy command`,
    );
    writeFileSync(
      join(userHome, ".claude", "commands", "notes.md"),
      `Personal notes`,
    );

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual(["deploy", "notes"]);
    expect(result.slashCommandDescriptions).toEqual({
      deploy: "Deploy command",
      notes: "Personal notes",
    });
  });

  it("namespaces plugin commands with the plugin name", async () => {
    const pluginDir = join(testRoot, "plugins", "commit-commands");
    const pluginCmdDir = join(pluginDir, "commands");
    mkdirSync(pluginCmdDir, { recursive: true });
    writeFileSync(
      join(pluginCmdDir, "commit.md"),
      `---\ndescription: Create a git commit\n---\n`,
    );
    writeFileSync(
      join(pluginCmdDir, "clean_gone.md"),
      `Remove tracking branches whose remote is gone`,
    );

    const manifestDir = join(userHome, ".claude", "plugins");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "commit-commands@claude-plugins-official": [{ installPath: pluginDir }],
        },
      }),
    );

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual([
      "commit-commands:clean_gone",
      "commit-commands:commit",
    ]);
    expect(result.slashCommandDescriptions).toEqual({
      "commit-commands:commit": "Create a git commit",
      "commit-commands:clean_gone": "Remove tracking branches whose remote is gone",
    });
  });

  it("lets project commands shadow user commands of the same name", async () => {
    mkdirSync(join(cwd, ".claude", "commands"), { recursive: true });
    mkdirSync(join(userHome, ".claude", "commands"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "commands", "deploy.md"),
      `Project deploy`,
    );
    writeFileSync(
      join(userHome, ".claude", "commands", "deploy.md"),
      `User deploy`,
    );

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommandDescriptions.deploy).toBe("Project deploy");
  });

  it("ignores malformed plugin manifests", async () => {
    const manifestDir = join(userHome, ".claude", "plugins");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, "installed_plugins.json"), "not json");

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual([]);
  });

  it("skips command entries without descriptions instead of inserting empty strings", async () => {
    const dir = join(cwd, ".claude", "commands");
    mkdirSync(dir, { recursive: true });
    // File with only headings — no usable description line.
    writeFileSync(join(dir, "bare.md"), `# Heading\n## Another\n`);

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual(["bare"]);
    expect(result.slashCommandDescriptions).toEqual({});
  });

  it("picks up project-level skills via SKILL.md", async () => {
    const skillDir = join(cwd, ".claude", "skills", "release-cli");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: release-cli\ndescription: Publish CLI to npm\n---\n\n# Release CLI\n`,
    );

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual(["release-cli"]);
    expect(result.slashCommandDescriptions).toEqual({
      "release-cli": "Publish CLI to npm",
    });
  });

  it("picks up user-level skills", async () => {
    const skillDir = join(userHome, ".claude", "skills", "debug-issue");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: debug-issue\ndescription: Diagnose a runtime issue\n---\n`,
    );

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual(["debug-issue"]);
    expect(result.slashCommandDescriptions["debug-issue"]).toBe(
      "Diagnose a runtime issue",
    );
  });

  it("namespaces plugin skills with the plugin name", async () => {
    const pluginDir = join(testRoot, "plugins", "codex");
    const pluginSkillDir = join(pluginDir, "skills", "codex-cli-runtime");
    mkdirSync(pluginSkillDir, { recursive: true });
    writeFileSync(
      join(pluginSkillDir, "SKILL.md"),
      `---\nname: codex-cli-runtime\ndescription: Run codex CLI tasks\n---\n`,
    );

    const manifestDir = join(userHome, ".claude", "plugins");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "codex@claude-plugins-official": [{ installPath: pluginDir }],
        },
      }),
    );

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual(["codex:codex-cli-runtime"]);
    expect(result.slashCommandDescriptions).toEqual({
      "codex:codex-cli-runtime": "Run codex CLI tasks",
    });
  });

  it("ignores flat .md skill files (only directory form is recognised)", async () => {
    const dir = join(cwd, ".claude", "skills");
    mkdirSync(dir, { recursive: true });
    // Flat file — Claude TUI does not register these as user-invocable.
    writeFileSync(
      join(dir, "flat-skill.md"),
      `---\ndescription: This should not be picked up\n---\n`,
    );

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual([]);
  });

  it("merges commands and skills into the same namespace", async () => {
    mkdirSync(join(cwd, ".claude", "commands"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "commands", "deploy.md"),
      `Deploy command`,
    );

    const skillDir = join(cwd, ".claude", "skills", "release-cli");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\ndescription: Publish CLI\n---\n`,
    );

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual(["deploy", "release-cli"]);
    expect(result.slashCommandDescriptions).toEqual({
      deploy: "Deploy command",
      "release-cli": "Publish CLI",
    });
  });
});
