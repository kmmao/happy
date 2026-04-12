/**
 * Tmux integration — detect availability and spawn sessions inside tmux.
 *
 * When tmux is available, the agent can spawn Happy CLI sessions inside
 * named tmux windows, allowing manual attachment for debugging.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "../logger";

const execFileAsync = promisify(execFile);

let tmuxAvailable: boolean | undefined;

/**
 * Check if tmux is installed and accessible.
 */
export async function isTmuxAvailable(): Promise<boolean> {
  if (tmuxAvailable !== undefined) return tmuxAvailable;
  try {
    await execFileAsync("tmux", ["-V"]);
    tmuxAvailable = true;
  } catch {
    tmuxAvailable = false;
  }
  return tmuxAvailable;
}

/** Reset cache (for testing). */
export function resetTmuxCache(): void {
  tmuxAvailable = undefined;
}

/**
 * Spawn a command inside a tmux session.
 * Creates the session if it doesn't exist, or adds a new window.
 *
 * @returns The tmux window identifier (session:window) or null on failure.
 */
export async function spawnInTmux(options: {
  sessionName: string;
  windowName: string;
  command: string;
  cwd: string;
  env?: Record<string, string>;
}): Promise<{ sessionWindow: string; pid: number } | null> {
  const { sessionName, windowName, command, cwd, env } = options;

  try {
    // Check if tmux session exists
    let sessionExists = false;
    try {
      await execFileAsync("tmux", ["has-session", "-t", sessionName]);
      sessionExists = true;
    } catch {
      // Session doesn't exist
    }

    // Build env flags
    const envFlags: string[] = [];
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        envFlags.push("-e", `${key}=${value}`);
      }
    }

    if (!sessionExists) {
      // Create new session with the first window
      await execFileAsync("tmux", [
        "new-session",
        "-d",
        "-s", sessionName,
        "-n", windowName,
        "-c", cwd,
        ...envFlags,
        command,
      ]);
    } else {
      // Add new window to existing session
      await execFileAsync("tmux", [
        "new-window",
        "-t", sessionName,
        "-n", windowName,
        "-c", cwd,
        ...envFlags,
        command,
      ]);
    }

    // Get the PID of the pane in the window
    const { stdout } = await execFileAsync("tmux", [
      "list-panes",
      "-t", `${sessionName}:${windowName}`,
      "-F", "#{pane_pid}",
    ]);

    const pid = parseInt(stdout.trim(), 10);
    if (isNaN(pid)) {
      logger.debug(`[TMUX] Failed to get PID for ${sessionName}:${windowName}`);
      return null;
    }

    const sessionWindow = `${sessionName}:${windowName}`;
    logger.debug(`[TMUX] Spawned in ${sessionWindow} (PID ${pid})`);
    return { sessionWindow, pid };
  } catch (error) {
    logger.debug(`[TMUX] Spawn failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
