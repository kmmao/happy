---
status: accepted
---

# Codex session/conversation-ID extraction stays two methods, not one pure extractor

## Context

`CodexMcpClient` (`packages/happy-cli/src/codex/codexMcpClient.ts`) discovers the
Codex `sessionId` / `conversationId` in two private methods:

- `updateIdentifiersFromEvent(event)` — called on every streaming message
  (`msg` at line 105).
- `extractIdentifiers(response)` — called on RPC responses (lines 315, 364).

Two separate architecture-review passes flagged this as fragile duplication and
proposed collapsing it into one pure `extractCodexSessionIds(response)` with a
documented priority order and unit tests.

Reading the two methods shows they are **not** duplication — they parse two
different Codex wire shapes with deliberately different precedence and different
write policies:

| | `updateIdentifiersFromEvent` (streaming) | `extractIdentifiers` (RPC response) |
|---|---|---|
| Key casing | `session_id` **and** `sessionId` (snake + camel) | `sessionId` only (camel) |
| Where it looks | `event`, `event.data` | `response.meta`, `response`, `response.content[]` |
| Precedence | last candidate wins | `meta` → top-level → `content[]` |
| Write policy | **overwrite always** when present | `meta`/top-level overwrite; `content[]` is **fill-if-missing** |

Codex streaming events carry snake_case ids nested under `event.data`; Codex MCP
tool responses carry camelCase ids under `meta` / `content[]`. The two methods
encode those two protocols.

## Decision

**Keep the two methods separate. Do not merge into one pure extractor.**

Merging would either (a) fork internally into both rule-sets — no simpler than
today — or (b) unify the rules and thereby change precedence / write policy in a
behavior-sensitive path that has **zero covering tests** and depends on exact
Codex payload shapes across versions. The risk outweighs the marginal locality
gain.

## Consequences

- A future review re-flagging "fragile ID extraction" in `codexMcpClient` should
  read this first: the similarity is superficial; the two methods target distinct
  wire shapes with distinct semantics.
- If Codex ever unifies its streaming and response id shapes (same casing, same
  location, same precedence), this ADR is void and a single extractor becomes the
  right move.
- The genuinely valuable follow-up, if this path causes incidents, is
  **characterization tests** pinning each method's current behavior against real
  captured Codex payloads — not a merge. That would require making the client's id
  state testable without a live socket first.
