/**
 * AgentLoop event matching — decides whether an inbound event is allowed to
 * drive a given AgentLoop, by its source allowlist and keyword filters.
 *
 * Extracted from `AgentLoopCoordinator.ts`, where it was private and reachable
 * only by emitting events at a configured loop. The matching rules carry
 * decisions worth pinning directly: case-folding of both allowlist and
 * keywords, an empty allowlist meaning "allow any source", and keyword matching
 * being a substring test over `title\ndetails` (so "bug" matches "debug" —
 * intentional today, but a rule a test should make explicit). No behavior
 * change: body moved verbatim.
 */

import type { AgentLoopDefinition, AgentLoopEvent } from "./AgentLoopStore";

export function evaluateLoopEventFilters(
  loop: Pick<AgentLoopDefinition, "eventSourceAllowlist" | "eventKeywordFilters">,
  event: Pick<AgentLoopEvent, "source" | "title" | "details">,
): { accepted: boolean; reason?: string } {
  const allowlist = loop.eventSourceAllowlist?.map((entry) => entry.toLowerCase());
  if (allowlist && allowlist.length > 0 && !allowlist.includes(event.source.toLowerCase())) {
    return { accepted: false, reason: `source '${event.source}' not allowed` };
  }

  const keywords = loop.eventKeywordFilters?.map((entry) => entry.toLowerCase());
  if (keywords && keywords.length > 0) {
    const haystack = `${event.title}
${event.details ?? ""}`.toLowerCase();
    const matched = keywords.some((keyword) => haystack.includes(keyword));
    if (!matched) {
      return { accepted: false, reason: "event does not match keyword filters" };
    }
  }

  return { accepted: true };
}
