/**
 * rawToSdkMessage — convert a JSONL record from `claude TUI` (RawJSONLines)
 * into the `SDKMessage`-shaped object the rest of the Remote pipeline
 * expects.
 *
 * Background
 * ----------
 * Pre-PTY-migration the launcher consumed messages emitted by the
 * `@anthropic-ai/claude-agent-sdk` `query()` stream — `SDKMessage` shape.
 * Post-migration we observe the same conversation by tailing
 * `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. These records share
 * most of their fields but differ on a few key names:
 *
 *   JSONL on-disk         SDK stream
 *   ─────────────────────────────────────
 *   sessionId             session_id
 *   parentUuid            (—)
 *   (—)                   parent_tool_use_id
 *
 * Plus the JSONL has fields the SDK never emitted (`cwd`, `gitBranch`,
 * `version`, `userType`, `entrypoint`, `timestamp`) and the SDK has
 * subtypes that never land in JSONL at all (`stream_event`, `task_*`,
 * `api_retry`, `compact_boundary`, `rate_limit_event`, …). Those SDK-only
 * subtypes are produced by the SDK's streaming layer — they simply do
 * not exist in the post-migration data flow. The launcher's defensive
 * branches for them become dead code, harmless.
 *
 * What this converter does
 * ------------------------
 *   1. Adds `session_id` (snake_case) alongside the original `sessionId`
 *      — consumers reading either key work.
 *   2. Promotes `parentUuid` → `parent_tool_use_id` for tool-call lineage.
 *   3. Otherwise passes through every field (camelCase + extras are
 *      preserved on the returned object — TypeScript view is narrower
 *      than the runtime view, on purpose).
 *
 * The returned value is typed as `SDKMessage` because every consumer in
 * the launcher reads it via that type. The runtime object is a superset
 * of what the type promises — that is the whole point of the seam.
 */

import type { RawJSONLines } from "@/claude/types";
import type { SDKMessage } from "@/claude/sdk";

/**
 * Convert a RawJSONLines record produced by `sessionScanner` into an
 * SDKMessage-shaped object. Returns `null` for records the launcher does
 * not consume (e.g. `summary` — which the launcher treats specially via
 * the title generator, so we surface it elsewhere).
 *
 * The returned object keeps every original field via spread; the typed
 * surface (SDKMessage) is intentionally narrower than the runtime shape.
 */
export function rawToSdkMessage(raw: RawJSONLines): SDKMessage | null {
  // `summary` records carry no model output — the launcher's onMessage
  // never had a branch for it (the SDK never emitted it). Callers that
  // care (e.g. the local launcher) pick it up directly from the scanner.
  if (raw.type === "summary") return null;

  // Common field promotion: sessionId → session_id, parentUuid → parent_tool_use_id.
  const anyRaw = raw as Record<string, unknown>;
  const sessionId = pickString(anyRaw, "sessionId") ?? pickString(anyRaw, "session_id");
  const parentToolUseId =
    pickString(anyRaw, "parent_tool_use_id") ?? pickString(anyRaw, "parentUuid") ?? null;

  // Build the result by spreading the original record and overlaying
  // the renamed keys. TypeScript erases the extras, but at runtime they
  // are still present — which is fine because no consumer narrows on
  // them via the SDKMessage view.
  const result = {
    ...anyRaw,
    session_id: sessionId,
    parent_tool_use_id: parentToolUseId,
  };

  return result as unknown as SDKMessage;
}

function pickString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}
