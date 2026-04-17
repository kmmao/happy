# Knowledge Injection — Optimization Backlog

Status: **draft** · Last updated 2026-04-17

Context: the current `fetch-knowledge` handler returns a profile block + up to
N entries + up to 5 action items. The CLI concatenates them into a markdown
system-prompt snippet (`formatKnowledgeForInjection` in
`packages/happy-cli/src/claude/.../formatKnowledge.ts`, also mirrored as the
static `KnowledgeClient.formatForInjection`). Each entry is pushed as:

```
💡 **Title** (high confidence, 2026-04-15T...)
   Content truncated to 300 chars ...
   Tags: #react #typescript
```

Profile section is always emitted first with techStack / architectureType /
knownPitfalls / coreConventions.

The filter chain correctly excludes `status != active` and `hotStatus == evicted`
after 2026-04-17.

This doc lists token-efficiency and signal-quality optimisations. Ranked P0–P2.

---

## P0 — Low effort, high impact

### 1. Confidence-weighted content budget
Today all entries get `content.slice(0, 300)`. High-confidence entries deserve
more headroom; low-confidence ones are often noise at 300 chars. Proposal:

| confidence | content chars |
|---|---|
| high   | 600 |
| medium | 300 |
| low    | 120 (or title-only) |

Impact: ~30% token reduction on typical batches without losing signal.

### 2. Relative timestamps
`2026-04-15T03:14:22.000Z` is 24 chars and low signal compared to `3d ago`.
Model treats them equivalently for reasoning. Use `formatDistanceToNow` style
strings.

Impact: ~20 chars saved per entry × 5–20 entries per fetch.

### 3. Strip Profile section when CLAUDE.md covers it
Many projects already document tech stack and conventions in the repo's
CLAUDE.md. The profile re-emits the same info as a structured block. Add a
toggle in `knowledgeConfig` (`injectProfile: boolean`, default true) so users
who maintain CLAUDE.md can disable duplication.

Impact: ~200–400 tokens per session.

### 4. Evicted / archived surfacing in App
Evicted in this session AND globally archived are already filtered from
injection (2026-04-17). But the user cannot tell *why* an entry isn't being
pushed. Make the reason visible in the References tab (already shows status
badges) and surface it in MCP `query_project_knowledge` responses so the model
doesn't re-fetch something the user consciously evicted.

---

## P1 — Moderate effort

### 5. Lazy hydration via MCP
Instead of injecting full content for every entry, inject only `{id, title,
confidence, tags, entryType}` as a catalogue, and rely on the model calling
`query_project_knowledge(id)` (MCP tool) to hydrate the few it actually needs.

Trade-off: model makes an extra tool call for relevant entries, but saves
tokens on the 80% of entries it never uses. Works well when combined with
turn-hit tracking (proven-useful entries auto-promote to full-content
injection).

### 6. Cite-friendly format
Swap markdown emoji headers for a compact cite-tag format:

```
[k:abc123 fix high react] Title …
   Content…
```

Where the bracketed prefix is a stable token. Assistant can reference them
with `[k:abc123]` in responses, giving CLI a **precise hit signal** (exact
id match vs current substring regex). Lets us remove "hit detection by tag
overlap" and get true cited-by-model telemetry.

### 7. Affected-files surfacing
Entries already store `affectedFiles`. Currently unused in injection. Add a
line `Files: src/a.ts, src/b.ts` per entry so Claude can triangulate which
entry is relevant for the current file context. Paired with CLI's existing
`currentTurnFilePaths` this becomes a much stronger relevance signal.

### 8. Pinned vs regular separation
`pinned=true` entries should always be injected regardless of budget, and
should appear at the top of the block with an explicit "pinned" prefix so
the model learns to treat them as durable rules (e.g. "always use TypeScript
strict mode"). Today they compete with unpinned entries in the same list.

---

## P2 — Larger refactors / speculative

### 9. Supersession chain collapse
`KnowledgeRelation` with `relationType=refines` and `supersedesId` encode
evolution. Inject only the latest link but add a `(v3, supersedes 2 older
entries)` note so the model knows history exists but isn't spammed.

### 10. Per-entry injection budget from token count (not chars)
Chars ≈ tokens only for ASCII. For CJK / code-heavy content, 300 chars can be
~600 tokens. Count tokens with tiktoken (already a dep for Claude API) and
truncate to a fixed token budget per entry.

### 11. Usage-guidance preamble
Add a one-line instruction at the top of the injected block:

```
## Project Knowledge (N entries, M active warnings)
> Cite entries with [k:id] when they directly informed a decision.
> Prefer "fix" entries for bug reports, "decision" entries for design review.
```

This primes the model to cite (feeds back into hit-tracking P1 #6) and pick
the right entry types for the current task.

### 12. Session-scoped prefetch based on open files
CLI already triggers a file-aware refetch after edits. Extend to **session
start**: if the session boots with X open files, prefetch entries matching
those files before the first user message. Reduces cold-start relevance miss.

### 13. Inject-time redaction
If a project has `injectSecrets: false` (new config), scan content for
`password|token|api_key|secret` patterns and redact `[REDACTED]` before
injection. Separate from LLM refinement (which happens at write time).

---

## Metrics to track

Once the TTL hit-detection pipeline is solid (landing 2026-04-17), instrument:

| Metric | Target |
|---|---|
| tokens per `fetch-knowledge` response | baseline + 50% reduction after P0 |
| hit rate (entries referenced / entries injected, per turn) | >= 30% |
| eviction rate (TTL-zero evictions / injected) | 40–60% (healthy turnover) |
| manual eviction rate (user-triggered / total evictions) | <10% (else re-tune initial budget) |

---

## Dependencies / call-out

- P1 #6 (cite-friendly format) requires a Claude prompt nudge; worth A/B
  testing against current regex-based detection before cutting over.
- P0 #3 needs a project-level CLAUDE.md presence check (exists via existing
  `happy-cli` file probing).
- P2 #10 requires shipping tiktoken to the server bundle; size cost ~3 MB.
