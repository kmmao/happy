import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { OPERATOR_ONLY_ENV_VARS } from "./operatorOnlyEnvironment";

const execFileAsync = promisify(execFile);
const bashExecutable = process.env.BASH || "/bin/bash";

export const SERVER_ONLY_ENV_VARS = new Set([
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "GITHUB_CLIENT_SECRET",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SESSION_TOKEN",
  "STRIPE_SECRET_KEY",
  "SENDGRID_API_KEY",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
]);

const STARTUP_SCRIPT_IGNORED_ENV_VARS = new Set([
  "OLDPWD",
  "PWD",
  "SHLVL",
  "_",
]);

export function getFilteredDaemonEnvironment(
  sourceEnv: NodeJS.ProcessEnv = process.env,
  options?: {
    excludeOperatorOnlyVars?: boolean;
  },
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(sourceEnv).filter(
      ([key, value]) =>
        value !== undefined &&
        !SERVER_ONLY_ENV_VARS.has(key) &&
        !(options?.excludeOperatorOnlyVars && OPERATOR_ONLY_ENV_VARS.has(key)),
    ),
  ) as Record<string, string>;
}

function parseEnvironmentSnapshot(snapshot: Buffer | string): Record<string, string> {
  return Buffer.from(snapshot)
    .toString("utf-8")
    .split("\0")
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return acc;
      }
      const key = entry.slice(0, separatorIndex);
      const value = entry.slice(separatorIndex + 1);
      acc[key] = value;
      return acc;
    }, {});
}

function diffEnvironmentSnapshot(
  nextEnv: Record<string, string>,
  baseEnv: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(nextEnv).filter(
      ([key, value]) =>
        !STARTUP_SCRIPT_IGNORED_ENV_VARS.has(key) && baseEnv[key] !== value,
    ),
  );
}

export async function resolveStartupScriptEnvironment(options: {
  cwd: string;
  startupBashScript: string;
  baseEnv: Record<string, string>;
}): Promise<Record<string, string>> {
  const script = options.startupBashScript.trim();
  if (!script) {
    return {};
  }

  const scriptDirectory = join(tmpdir(), "happy", "profile-startup");
  await mkdir(scriptDirectory, { recursive: true });
  const scriptPath = join(scriptDirectory, `${randomUUID()}.sh`);
  await writeFile(scriptPath, `${script}\n`, { mode: 0o600 });

  try {
    const { stdout } = await execFileAsync(
      bashExecutable,
      [
        "-c",
        'set -ae\nsource "$1"\nenv -0',
        "happy-startup-script",
        scriptPath,
      ],
      {
        cwd: options.cwd,
        env: options.baseEnv,
        encoding: "buffer",
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const nextEnv = parseEnvironmentSnapshot(stdout);
    return diffEnvironmentSnapshot(nextEnv, options.baseEnv);
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
}
