/**
 * High-level orchestrator for "fork / duplicate from message" flows.
 *
 * Calls the CLI's `forkSession` RPC to clone a session's JSONL up to a chosen
 * message (the precise rewind anchor is the Claude UUID stored on the source
 * envelope as `claudeUuid`). The RPC returns the new Claude session id and the
 * project path; we then spawn a fresh Happy session that --resumes that new
 * Claude session, carrying the `forkSourceId` so the daemon writes lineage
 * metadata and the App can show a "forked from …" link.
 *
 * Both fork variants share the same machinery:
 *   - "fork from active session" (no message anchor) — keep the whole
 *     transcript, branch off the current head. The CLI's `forkSession`
 *     accepts an undefined `upToMessageId` and copies everything.
 *   - "duplicate from message" — truncate the JSONL after the chosen user
 *     message and start fresh from there.
 *
 * Failure modes are surfaced as a tagged union so call sites can render
 * meaningful UI without sprinkling try/catch.
 */

import { machineSpawnNewSession, sessionForkSession } from "@/sync/ops";
import type { SpawnSessionOptions } from "@/sync/ops";

export type ForkSessionOutcome =
  | { type: "success"; sessionId: string }
  | {
      type: "requestToApproveDirectoryCreation";
      directory: string;
      /** Retry the spawn after directory creation was approved. */
      retry: (
        approvedDirectory?: string,
      ) => Promise<ForkSessionOutcome>;
    }
  | { type: "error"; errorMessage: string };

export interface ForkSessionInput {
  /** Source Happy session id we're forking from. */
  sourceSessionId: string;
  /** Spawn options for the *new* session — directory, profile, env, etc. */
  baseSpawnOptions: SpawnSessionOptions;
  /**
   * Claude JSONL message UUID to truncate at (inclusive). Omit to copy the
   * entire transcript, which is the "fork from active session" path.
   */
  upToMessageId?: string;
  /**
   * Optional title for the new session's `custom-title` JSONL record. When
   * omitted, the CLI falls back to "<original> (fork)" if the source has a
   * custom title.
   */
  title?: string;
}

/**
 * Drive a fork/duplicate end-to-end: CLI fork RPC → daemon spawn → return
 * the new Happy session id. Both steps are needed because forking only
 * produces a new *Claude* session on disk; the App still needs a Happy
 * session object to navigate to.
 */
export async function forkSessionFromMessage(
  input: ForkSessionInput,
): Promise<ForkSessionOutcome> {
  const { sourceSessionId, baseSpawnOptions, upToMessageId, title } = input;

  const forkResult = await sessionForkSession(sourceSessionId, {
    ...(upToMessageId ? { upToMessageId } : {}),
    ...(title ? { title } : {}),
  });
  if ("error" in forkResult) {
    return { type: "error", errorMessage: forkResult.error };
  }

  // The CLI also returned the project path the new JSONL lives in. We pass
  // it back into the spawn so the daemon uses the same directory (vs.
  // re-resolving from baseSpawnOptions, which would risk mismatch when the
  // source session was started in a different cwd).
  return await spawnForkedSession({
    sourceSessionId,
    forkedClaudeSessionId: forkResult.claudeSessionId,
    forkedProjectPath: forkResult.path,
    baseSpawnOptions,
  });
}

interface SpawnForkedInput {
  sourceSessionId: string;
  forkedClaudeSessionId: string;
  forkedProjectPath: string;
  baseSpawnOptions: SpawnSessionOptions;
}

async function spawnForkedSession(
  input: SpawnForkedInput,
): Promise<ForkSessionOutcome> {
  const { sourceSessionId, forkedClaudeSessionId, forkedProjectPath, baseSpawnOptions } = input;

  const spawnOptions: SpawnSessionOptions = {
    ...baseSpawnOptions,
    directory: forkedProjectPath,
    claudeSessionId: forkedClaudeSessionId,
    forkSourceId: sourceSessionId,
  };

  const result = await machineSpawnNewSession(spawnOptions);
  if (result.type === "error") {
    return { type: "error", errorMessage: result.errorMessage };
  }
  if (result.type === "requestToApproveDirectoryCreation") {
    return {
      type: "requestToApproveDirectoryCreation",
      directory: result.directory,
      retry: async (approvedDirectory) => {
        const retryResult = await machineSpawnNewSession({
          ...spawnOptions,
          directory: approvedDirectory ?? spawnOptions.directory,
          approvedNewDirectoryCreation: true,
        });
        if (retryResult.type === "error") {
          return { type: "error", errorMessage: retryResult.errorMessage };
        }
        if (retryResult.type === "requestToApproveDirectoryCreation") {
          return {
            type: "error",
            errorMessage:
              "Daemon still requesting directory approval after retry",
          };
        }
        return { type: "success", sessionId: retryResult.sessionId };
      },
    };
  }
  return { type: "success", sessionId: result.sessionId };
}
