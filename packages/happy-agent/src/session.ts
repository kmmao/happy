/**
 * Re-export bridge — SessionClient now lives in api/sessionClient.ts.
 * This file preserves backward compatibility for existing imports.
 */

export { SessionClient } from "./api/sessionClient";
export type { SessionClientOptions } from "./api/sessionClient";
