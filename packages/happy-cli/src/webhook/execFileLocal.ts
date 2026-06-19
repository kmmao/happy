import { execFile } from "child_process";

/**
 * Run a local command for webhook intake (gh / curl / git) and resolve a total
 * result — it NEVER rejects. Failure is reported as `exitCode` (the child's code,
 * or 1 for spawn/timeout errors), so callers branch on `exitCode` instead of
 * try/catch. Bounded by a 30s timeout. This contract is relied on by
 * `fetchIssueComments` (best-effort, must not block launch) and
 * `createWorktreeLocal` (inspects exitCode per step), so it lives in one place.
 */
export function execFileLocal(
  file: string,
  args: readonly string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { cwd, timeout: 30_000 },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error
            ? typeof error.code === "number"
              ? error.code
              : 1
            : 0,
        });
      },
    );
  });
}
