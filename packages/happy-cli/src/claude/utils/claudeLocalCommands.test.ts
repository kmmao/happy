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
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";

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

  it("extracts YAML folded block scalar description (`description: >`)", async () => {
    const dir = join(cwd, ".claude", "skills", "caveman");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      `---\nname: caveman\ndescription: >\n  Ultra-compressed mode. Cuts token usage ~75% by dropping\n  filler and pleasantries.\n  Use when user says "caveman" or invokes /caveman.\n---\n\nBody.`,
    );

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommandDescriptions.caveman).toBe(
      `Ultra-compressed mode. Cuts token usage ~75% by dropping filler and pleasantries. Use when user says "caveman" or invokes /caveman.`,
    );
  });

  it("extracts YAML literal block scalar description (`description: |`)", async () => {
    const dir = join(cwd, ".claude", "commands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "multi.md"),
      `---\ndescription: |\n  Line one of the help.\n  Line two continues.\n---\n`,
    );

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommandDescriptions.multi).toBe(
      `Line one of the help. Line two continues.`,
    );
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

  it("follows symlinked skill directories (dotfile-repo install pattern)", async () => {
    // Real skill lives outside ~/.claude/skills/ — mirrors what
    // setup-matt-pocock-skills and similar dotfile-managed setups do.
    const realSkill = join(testRoot, "dotfiles", "skills", "diagnose");
    mkdirSync(realSkill, { recursive: true });
    writeFileSync(
      join(realSkill, "SKILL.md"),
      `---\nname: diagnose\ndescription: Diagnose a runtime issue\n---\n`,
    );

    const linkParent = join(userHome, ".claude", "skills");
    mkdirSync(linkParent, { recursive: true });
    symlinkSync(realSkill, join(linkParent, "diagnose"), "dir");

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual(["diagnose"]);
    expect(result.slashCommandDescriptions.diagnose).toBe(
      "Diagnose a runtime issue",
    );
  });

  it("follows symlinked command .md files", async () => {
    const realFile = join(testRoot, "dotfiles", "commands", "deploy.md");
    mkdirSync(join(testRoot, "dotfiles", "commands"), { recursive: true });
    writeFileSync(realFile, `---\ndescription: Deploy\n---\n`);

    const linkParent = join(userHome, ".claude", "commands");
    mkdirSync(linkParent, { recursive: true });
    symlinkSync(realFile, join(linkParent, "deploy.md"), "file");

    const result = await collectClaudeLocalCommands({ cwd, userHome });
    expect(result.slashCommands).toEqual(["deploy"]);
    expect(result.slashCommandDescriptions.deploy).toBe("Deploy");
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

  it("emits slashCommandsRich tagged with source/kind/plugin per entry", async () => {
    // project command
    mkdirSync(join(cwd, ".claude", "commands"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "commands", "deploy.md"),
      `---\ndescription: Project deploy\n---\n`,
    );
    // user command
    mkdirSync(join(userHome, ".claude", "commands"), { recursive: true });
    writeFileSync(
      join(userHome, ".claude", "commands", "notes.md"),
      `Personal notes`,
    );
    // user skill
    const userSkillDir = join(userHome, ".claude", "skills", "debug-issue");
    mkdirSync(userSkillDir, { recursive: true });
    writeFileSync(
      join(userSkillDir, "SKILL.md"),
      `---\ndescription: Diagnose runtime issues\n---\n`,
    );
    // project skill
    const projectSkillDir = join(cwd, ".claude", "skills", "release-cli");
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(
      join(projectSkillDir, "SKILL.md"),
      `---\ndescription: Publish CLI\n---\n`,
    );
    // plugin command + skill
    const pluginDir = join(testRoot, "plugins", "codex");
    mkdirSync(join(pluginDir, "commands"), { recursive: true });
    writeFileSync(
      join(pluginDir, "commands", "rescue.md"),
      `---\ndescription: Codex rescue\n---\n`,
    );
    const pluginSkillDir = join(pluginDir, "skills", "codex-cli-runtime");
    mkdirSync(pluginSkillDir, { recursive: true });
    writeFileSync(
      join(pluginSkillDir, "SKILL.md"),
      `---\ndescription: Run codex CLI\n---\n`,
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

    const byName = Object.fromEntries(
      result.slashCommandsRich.map((c) => [c.name, c]),
    );
    expect(byName.deploy).toMatchObject({
      source: "project",
      kind: "command",
      description: "Project deploy",
    });
    expect(byName.deploy.plugin).toBeUndefined();
    expect(byName.notes).toMatchObject({ source: "user", kind: "command" });
    expect(byName["debug-issue"]).toMatchObject({
      source: "user",
      kind: "skill",
    });
    expect(byName["release-cli"]).toMatchObject({
      source: "project",
      kind: "skill",
    });
    expect(byName["codex:rescue"]).toMatchObject({
      source: "plugin",
      kind: "command",
      plugin: "codex",
    });
    expect(byName["codex:codex-cli-runtime"]).toMatchObject({
      source: "plugin",
      kind: "skill",
      plugin: "codex",
    });
  });
});
