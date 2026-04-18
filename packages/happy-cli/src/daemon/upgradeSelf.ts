import { execFile as execFileCb, spawn as spawnCb } from "node:child_process";
import type { ChildProcess, ExecFileOptions, SpawnOptions } from "node:child_process";
import { promisify } from "node:util";

import { detectCliInstallInfo } from "./cliInstallInfo";

const execFileAsync = promisify(execFileCb);

const VERSION_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

export interface UpgradeSelfResult {
  readonly success: boolean;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly error?: string;
}

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess | { unref: () => void };

function getNpmExecutable(platform: NodeJS.Platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function getHappyExecutable(platform: NodeJS.Platform): string {
  return platform === "win32" ? "happy.cmd" : "happy";
}

function sanitizeEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const cleanEnv = { ...(env ?? process.env) };
  delete cleanEnv.CLAUDECODE;
  return cleanEnv;
}

function toFailureResult(error: unknown): UpgradeSelfResult {
  const execError = error as Error & {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
    code?: number | string;
  };

  return {
    success: false,
    stdout:
      typeof execError.stdout === "string"
        ? execError.stdout
        : execError.stdout?.toString() ?? "",
    stderr:
      typeof execError.stderr === "string"
        ? execError.stderr
        : execError.stderr?.toString() ??
          execError.message ??
          "Command failed",
    exitCode: typeof execError.code === "number" ? execError.code : 1,
    error: execError.message ?? "Command failed",
  };
}

export async function upgradeSelf(params: {
  targetVersion: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execFile?: ExecFileLike;
  spawn?: SpawnLike;
  detectInstallInfo?: typeof detectCliInstallInfo;
}): Promise<UpgradeSelfResult> {
  const {
    targetVersion,
    platform = process.platform,
    env,
    execFile = execFileAsync,
    spawn = spawnCb,
    detectInstallInfo = detectCliInstallInfo,
  } = params;

  if (!VERSION_RE.test(targetVersion)) {
    return {
      success: false,
      error: `Invalid version format: ${targetVersion}`,
    };
  }

  const cleanEnv = sanitizeEnv(env);
  const npmExecutable = getNpmExecutable(platform);
  const happyExecutable = getHappyExecutable(platform);

  try {
    const installInfo = await detectInstallInfo({
      platform,
      execFile,
    });
    if (!installInfo.canSelfUpgrade) {
      return {
        success: false,
        error: `Self-upgrade is not available for install source: ${installInfo.source}`,
      };
    }

    const installResult = await execFile(
      npmExecutable,
      ["install", "-g", `@kmmao/happy-coder@${targetVersion}`],
      {
        env: cleanEnv,
        windowsHide: true,
        timeout: 180_000,
      },
    );

    const child = spawn(happyExecutable, ["daemon", "start-sync"], {
      detached: true,
      stdio: "ignore",
      env: cleanEnv,
      windowsHide: true,
    });
    child.unref();

    return {
      success: true,
      stdout:
        typeof installResult.stdout === "string"
          ? installResult.stdout
          : installResult.stdout.toString(),
      stderr:
        typeof installResult.stderr === "string"
          ? installResult.stderr
          : installResult.stderr.toString(),
      exitCode: 0,
    };
  } catch (error) {
    return toFailureResult(error);
  }
}
