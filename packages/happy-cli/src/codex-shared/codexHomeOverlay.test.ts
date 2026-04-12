import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexHomeOverlay } from "./codexHomeOverlay";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("createCodexHomeOverlay", () => {
  it("preserves codex home content while overriding auth.json", async () => {
    const sourceHome = await makeTempDir("happy-codex-home-source-");
    await mkdir(join(sourceHome, "sessions"), { recursive: true });
    await mkdir(join(sourceHome, "skills"), { recursive: true });
    await writeFile(join(sourceHome, "config.toml"), "model = \"gpt-5.4\"\n", "utf8");
    await writeFile(join(sourceHome, "sessions", "resume.jsonl"), "resume", "utf8");
    await writeFile(join(sourceHome, "skills", "README.md"), "skill", "utf8");
    await writeFile(join(sourceHome, "auth.json"), "{\"old\":true}", "utf8");

    const overlay = await createCodexHomeOverlay({
      sourceHome,
      authJson: "{\"new\":true}",
    });
    tempDirs.push(overlay.path);

    await expect(readFile(join(overlay.path, "config.toml"), "utf8")).resolves.toBe(
      "model = \"gpt-5.4\"\n",
    );
    await expect(
      readFile(join(overlay.path, "sessions", "resume.jsonl"), "utf8"),
    ).resolves.toBe("resume");
    await expect(
      readFile(join(overlay.path, "skills", "README.md"), "utf8"),
    ).resolves.toBe("skill");
    await expect(readFile(join(overlay.path, "auth.json"), "utf8")).resolves.toBe(
      "{\"new\":true}",
    );
  });

  it("creates an auth-only overlay when the source home does not exist", async () => {
    const parentDir = await makeTempDir("happy-codex-home-missing-");
    const overlay = await createCodexHomeOverlay({
      sourceHome: join(parentDir, "missing-home"),
      authJson: "{\"token\":\"abc\"}",
    });
    tempDirs.push(overlay.path);

    await expect(readFile(join(overlay.path, "auth.json"), "utf8")).resolves.toBe(
      "{\"token\":\"abc\"}",
    );
  });

  it("cleans up the overlay directory", async () => {
    const sourceHome = await makeTempDir("happy-codex-home-cleanup-");
    const overlay = await createCodexHomeOverlay({
      sourceHome,
      authJson: "{\"token\":\"abc\"}",
    });

    await overlay.cleanup();

    await expect(access(overlay.path, constants.F_OK)).rejects.toBeTruthy();
  });
});
