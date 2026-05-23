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
});
