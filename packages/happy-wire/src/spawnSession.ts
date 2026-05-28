import * as z from "zod";

/**
 * Result of the `spawn-happy-session` machine RPC: the App asks a CLI daemon to
 * start a session in a directory, and the daemon answers with one of three
 * outcomes. This crosses a process boundary (App ↔ CLI daemon), so it lives
 * here as the single source of truth and gains a runtime-validated surface.
 *
 * NOTE: happy-agent's local `spawnSession` returns a different shape
 * (`{ type: "success"; pid; directory }`) because it forks a child process
 * rather than reconnecting an App-visible session. That is a distinct
 * operation and is intentionally NOT unified with this contract.
 */
export const SpawnSessionResultSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("success"),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("requestToApproveDirectoryCreation"),
    directory: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    errorMessage: z.string(),
  }),
]);
export type SpawnSessionResult = z.infer<typeof SpawnSessionResultSchema>;
