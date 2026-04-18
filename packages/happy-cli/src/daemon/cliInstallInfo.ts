import { execFile as execFileCb, type ExecFileOptions } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { CliInstallInfo } from "@kmmao/happy-wire";

import { projectPath } from "@/projectPath";

const execFileAsync = promisify(execFileCb);

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

function normalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isWithinPath(path: string, root: string): boolean {
  if (path === root) {
    return true;
  }
  return path.startsWith(`${root}${sep}`);
}

function findGitRoot(
  startPath: string,
  pathExists: (candidate: string) => boolean,
): string | null {
  let current = startPath;
  while (true) {
    if (pathExists(resolve(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function getNpmExecutable(platform: NodeJS.Platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export async function detectCliInstallInfo(params?: {
  packagePath?: string;
  platform?: NodeJS.Platform;
  execFile?: ExecFileLike;
  pathExists?: (candidate: string) => boolean;
}): Promise<CliInstallInfo> {
  const packagePath = normalizePath(params?.packagePath ?? projectPath());
  const platform = params?.platform ?? process.platform;
  const execFile = params?.execFile ?? execFileAsync;
  const pathExists = params?.pathExists ?? existsSync;

  try {
    const npmExecutable = getNpmExecutable(platform);
    const result = await execFile(npmExecutable, ["root", "-g"], {
      windowsHide: true,
      timeout: 15_000,
    });
    const npmGlobalRoot = normalizePath(result.stdout.toString().trim());
    if (npmGlobalRoot && isWithinPath(packagePath, npmGlobalRoot)) {
      return {
        source: "npm-global",
        canSelfUpgrade: true,
      };
    }
  } catch {
    // Fall through to local/unknown heuristics
  }

  if (findGitRoot(packagePath, pathExists)) {
    return {
      source: "local-source",
      canSelfUpgrade: false,
    };
  }

  return {
    source: "unknown",
    canSelfUpgrade: false,
  };
}
