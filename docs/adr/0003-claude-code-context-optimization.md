# Claude Code session context optimization

Each new Claude Code session starts with ~50k tokens of initial context (system prompt, CLAUDE.md, skills metadata, MCP tool schemas, auto-memory rules, git instructions). This overhead reduces the usable context window and increases per-turn cost. We defined three optimization tiers and chose **Minimal** for daily use.

**Active scheme: Minimal** (since 2026-05-18)

## Schemes

### Lite (~5-6k tokens saved)

Smallest footprint change. Keeps full system prompt, auto-memory, and all built-in behaviors. Adds Tool Search to defer MCP tool schema loading and removes git commit/PR instructions already covered by CLAUDE.md.

```jsonc
// settings.json
{
  "env": {
    "ENABLE_TOOL_SEARCH": "auto"
  },
  "includeGitInstructions": false,
  "includeCoAuthoredBy": false,
  "awaySummaryEnabled": false,
  "feedbackSurveyRate": 0
}
```

| Setting | Effect |
|---------|--------|
| `ENABLE_TOOL_SEARCH: "auto"` | MCP tool schemas load on-demand instead of upfront (~30 tools deferred) |
| `includeGitInstructions: false` | Remove built-in git commit/PR formatting rules (~3-4k tokens) |
| `includeCoAuthoredBy: false` | Remove Co-Authored-By injection rule |
| `awaySummaryEnabled: false` | Remove away summary generation |

### Standard (~8-9k tokens saved)

Lite + disable auto-memory. Cross-session memory files (MEMORY.md) remain on disk but the ~3k-token memory system instructions are removed from the prompt. Manual `/remember` still works.

```jsonc
// settings.json (additions over Lite)
{
  "env": {
    "ENABLE_TOOL_SEARCH": "auto",
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"
  },
  "autoMemoryEnabled": false,
  "includeGitInstructions": false,
  "includeCoAuthoredBy": false,
  "awaySummaryEnabled": false,
  "feedbackSurveyRate": 0
}
```

| Setting | Effect |
|---------|--------|
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1"` | Remove auto-memory system instructions (~3k tokens) |
| `autoMemoryEnabled: false` | Disable auto-memory UI/behavior |

### Minimal (~15k+ tokens saved) — ACTIVE

Standard + simplified system prompt. Replaces the full Claude Code system prompt (~12k tokens) with a compact version. Loses some built-in behavior guidance (PR creation format, safety reminders, tool usage patterns) but CLAUDE.md covers most of these for this project.

```jsonc
// settings.json (additions over Standard)
{
  "env": {
    "ENABLE_TOOL_SEARCH": "auto",
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
    "CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT": "1",
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "DISABLE_EXTRA_USAGE_COMMAND": "1"
  },
  "autoMemoryEnabled": false,
  "includeGitInstructions": false,
  "includeCoAuthoredBy": false,
  "awaySummaryEnabled": false,
  "feedbackSurveyRate": 0,
  "showClearContextOnPlanAccept": true
}
```

| Setting | Effect |
|---------|--------|
| `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: "1"` | Use compact system prompt (~8-10k tokens saved) |
| `CLAUDE_CODE_ATTRIBUTION_HEADER: "0"` | Remove attribution header |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1"` | Disable telemetry network requests |
| `DISABLE_EXTRA_USAGE_COMMAND: "1"` | Disable extra usage reporting |
| `showClearContextOnPlanAccept: true` | Auto-clear context when plan is accepted |

## Complementary actions (applied alongside any scheme)

These are one-time actions independent of the scheme choice:

- **Disable unused MCP servers**: `/mcp disable chrome-devtools` when not debugging UI (~8k tokens)
- **Skill `disable-model-invocation`**: Add to rarely-used skills so their metadata is excluded from the prompt (~2-3k tokens)
- **Remove unused plugins**: Unregistered thedotmack/claude-mem marketplace (~1.7k tokens)
- **Proactive `/compact`**: Run every 30-45 minutes instead of waiting for auto-compaction

## Trade-offs

| | Lite | Standard | Minimal |
|---|---|---|---|
| Tokens saved | ~5-6k | ~8-9k | ~15k+ |
| Cross-session memory | Full | Files remain, rules removed | Files remain, rules removed |
| Built-in git/PR instructions | Removed (CLAUDE.md covers) | Removed | Removed |
| System prompt completeness | Full | Full | Simplified |
| Risk of behavior regression | None | Low (memory not auto-updated) | Medium (some built-in guidance missing) |

## 200K context window limit — ENABLED

`CLAUDE_CODE_DISABLE_1M_CONTEXT: "1"` forces the context window from 1M to 200K, even when using a 1M-capable model (e.g. Opus 4.6 1M). Independent of the scheme tiers above — applied on top of whichever scheme is active.

```jsonc
// settings.json env
"CLAUDE_CODE_DISABLE_1M_CONTEXT": "1"
```

| | 1M (default) | 200K (with flag) |
|---|---|---|
| Context window | 1,000K | 200K |
| Auto-compaction trigger (~80%) | ~800K | ~160K |
| Per-turn cost at late session | High (full history sent each turn) | Lower (compacted earlier) |
| Context detail retention | Full until ~800K | Lossy after ~160K |
| Best for | Long multi-hour sessions, large refactors | Short tasks, cost-sensitive usage |

**Current decision**: Enabled (since 2026-05-18). Compaction at ~160K keeps per-turn cost low. If long sessions frequently lose critical context, disable by removing the env var.

**Considered alternatives:**
- Splitting CLAUDE.md per-package only — already done, but packages still load eagerly when the project root is active. Marginal gain.
- Third-party context-mode plugin (SQLite sandboxing, 98% compression on tool outputs) — overkill for this project's MCP usage volume; revisit if MCP tool count grows significantly.
