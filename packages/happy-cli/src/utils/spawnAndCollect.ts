/**
 * Spawn a child process and collect its full stdout/stderr.
 */

import { spawn, SpawnOptions } from 'child_process';

export interface SpawnCollectResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * The single owner of the "run a subprocess and collect its full output" invariant:
 * buffer stdout and stderr to completion, normalise a null exit code to 0, and reject
 * if the process cannot be spawned.
 *
 * Callers vary only in the command, args, and spawn options (stdio / cwd / env /
 * timeout / shell / ...) — all of which are inputs, not behaviour. Keep this the only
 * place the accumulate-and-resolve lifecycle lives so a fix (signal handling, encoding,
 * timeouts) lands once instead of drifting across each wrapper.
 */
export function spawnAndCollect(
  command: string,
  args: string[],
  options?: SpawnOptions
): Promise<SpawnCollectResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options ?? {});

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code || 0,
        stdout,
        stderr
      });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}
