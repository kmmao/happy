import { SERVER_ONLY_ENV_VARS } from "./serverOnlyEnvironment";

/**
 * Environment variables the operator supplies to the daemon that must not be
 * forwarded verbatim into a spawned session. Two groups:
 *  1. Provider credentials (Anthropic/OpenAI/etc.) — the session gets its own
 *     resolved profile values instead of the daemon's.
 *  2. Server-internal secrets — imported from serverOnlyEnvironment so this
 *     never-leak invariant has a single owner and cannot drift.
 */
export const OPERATOR_ONLY_ENV_VARS = new Set([
  // Anthropic
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  // OpenAI / Codex
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  // Google / Gemini
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  // Other providers
  "TOGETHER_API_KEY",
  "CODEX_HOME",
  // OAuth
  "CLAUDE_CODE_OAUTH_TOKEN",
  // Server internals that must never leak (single owner: serverOnlyEnvironment)
  ...SERVER_ONLY_ENV_VARS,
]);
