import { access, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

function resolveCodexHomePath(pathValue?: string): string {
  const raw = pathValue || join(homedir(), ".codex");
  const expandedHome = raw.replace(/^~(?=\/|$)/, homedir());
  return isAbsolute(expandedHome) ? expandedHome : resolve(expandedHome);
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function symlinkEntry(
  targetPath: string,
  overlayPath: string,
  directory: boolean,
): Promise<void> {
  if (process.platform === "win32") {
    await symlink(targetPath, overlayPath, directory ? "junction" : "file");
    return;
  }

  await symlink(targetPath, overlayPath);
}

export interface CodexHomeOverlay {
  path: string;
  cleanup: () => Promise<void>;
}

export async function createCodexHomeOverlay(options: {
  authJson: string;
  sourceHome?: string;
}): Promise<CodexHomeOverlay> {
  const sourceHome = resolveCodexHomePath(options.sourceHome);
  const overlayPath = await mkdtemp(join(tmpdir(), "happy-codex-home-"));

  await mkdir(overlayPath, { recursive: true });

  if (await pathExists(sourceHome)) {
    const entries = await readdir(sourceHome, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "auth.json") {
        continue;
      }

      await symlinkEntry(
        join(sourceHome, entry.name),
        join(overlayPath, entry.name),
        entry.isDirectory(),
      );
    }
  }

  await writeFile(join(overlayPath, "auth.json"), options.authJson, "utf8");

  return {
    path: overlayPath,
    cleanup: async () => {
      await rm(overlayPath, { recursive: true, force: true });
    },
  };
}
