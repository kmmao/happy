import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectCodexLocalSurface } from "../localSurface";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("collectCodexLocalSurface", () => {
  it("collects prompts, skills, and agents from project and global Codex surfaces", async () => {
    const cwd = await makeTempDir("happy-codex-cwd-");
    const codexHome = await makeTempDir("happy-codex-home-");
    const userHome = await makeTempDir("happy-codex-user-");

    await mkdir(join(cwd, ".codex", "prompts"), { recursive: true });
    await mkdir(join(cwd, ".codex", "agents"), { recursive: true });
    await mkdir(join(cwd, ".agents", "skills", "project-skill"), {
      recursive: true,
    });
    await mkdir(join(codexHome, "prompts"), { recursive: true });
    await mkdir(join(codexHome, "agents"), { recursive: true });
    await mkdir(join(userHome, ".agents", "skills", "global-skill"), {
      recursive: true,
    });

    await writeFile(
      join(cwd, ".codex", "prompts", "project-plan.md"),
      "# Project Plan\n\nUse the project plan workflow.",
      "utf8",
    );
    await writeFile(
      join(codexHome, "prompts", "global-review.md"),
      "# Global Review\n\nReview the current diff for correctness.",
      "utf8",
    );
    await writeFile(
      join(cwd, ".agents", "skills", "project-skill", "SKILL.md"),
      "---\ndescription: Project-specific workflow\n---\n# Project Skill",
      "utf8",
    );
    await writeFile(
      join(userHome, ".agents", "skills", "global-skill", "SKILL.md"),
      "---\ndescription: Global workflow\n---\n# Global Skill",
      "utf8",
    );
    await writeFile(
      join(cwd, ".codex", "agents", "reviewer.toml"),
      "name = \"reviewer\"\n",
      "utf8",
    );
    await writeFile(
      join(codexHome, "agents", "docs-researcher.toml"),
      "name = \"docs-researcher\"\n",
      "utf8",
    );

    const surface = await collectCodexLocalSurface({ cwd, codexHome, userHome });

    expect(surface.prompts.map((prompt) => prompt.name)).toEqual([
      "project-plan",
      "global-review",
    ]);
    expect(surface.slashCommands).toEqual(["project-plan", "global-review"]);
    expect(surface.slashCommandDescriptions).toEqual({
      "project-plan": "Use the project plan workflow.",
      "global-review": "Review the current diff for correctness.",
    });
    expect(surface.skills.map((skill) => skill.name)).toEqual([
      "project-skill",
      "global-skill",
    ]);
    expect(surface.agents.map((agent) => agent.name)).toEqual([
      "reviewer",
      "docs-researcher",
    ]);
  });

  it("dedupes project and global entries by name, preferring project-local ones", async () => {
    const cwd = await makeTempDir("happy-codex-dedupe-cwd-");
    const codexHome = await makeTempDir("happy-codex-dedupe-home-");
    const userHome = await makeTempDir("happy-codex-dedupe-user-");

    await mkdir(join(cwd, ".codex", "prompts"), { recursive: true });
    await mkdir(join(codexHome, "prompts"), { recursive: true });
    await mkdir(join(cwd, ".agents", "skills", "shared-skill"), {
      recursive: true,
    });
    await mkdir(join(userHome, ".agents", "skills", "shared-skill"), {
      recursive: true,
    });

    await writeFile(
      join(cwd, ".codex", "prompts", "shared.md"),
      "# Shared\n\nProject prompt",
      "utf8",
    );
    await writeFile(
      join(codexHome, "prompts", "shared.md"),
      "# Shared\n\nGlobal prompt",
      "utf8",
    );
    await writeFile(
      join(cwd, ".agents", "skills", "shared-skill", "SKILL.md"),
      "---\ndescription: Project skill\n---\n# Shared Skill",
      "utf8",
    );
    await writeFile(
      join(userHome, ".agents", "skills", "shared-skill", "SKILL.md"),
      "---\ndescription: Global skill\n---\n# Shared Skill",
      "utf8",
    );

    const surface = await collectCodexLocalSurface({ cwd, codexHome, userHome });

    expect(surface.prompts).toHaveLength(1);
    expect(surface.prompts[0]?.description).toBe("Project prompt");
    expect(surface.skills).toHaveLength(1);
    expect(surface.skills[0]?.description).toBe("Project skill");
  });
});
