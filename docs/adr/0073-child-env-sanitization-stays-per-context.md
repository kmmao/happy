---
status: accepted
---

# Child-process env sanitization stays per-context, not one shared seam

## Context

Three spawn sites build a sanitized environment for a child process, and all
three `delete env.CLAUDECODE`, which reads like a shared invariant begging for a
`sanitizeChildEnv` seam:

- `claude/pty/claudePtyRuntime.ts` — strips the full
  `CLAUDE_PARENT_SESSION_ENV_KEYS` set (~10 Claude-owned process-context markers,
  including `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`,
  …) so the spawned Claude PTY is not mistaken for a nested child session, then
  ADDS terminal vars (`TERM`, `COLORTERM`, `COLUMNS`, `LINES`, `HAPPY_TERMINAL`).
- `daemon/upgradeSelf.ts` — strips ONLY `CLAUDECODE`.
- `happy-agent/daemon/spawnSession.ts` — strips `SERVER_INTERNAL_SECRETS` +
  `CLAUDECODE` (a different package; the two CLIs cannot import each other).

## Decision

Keep the three sanitizers separate. Their only literal overlap is the one-line
`delete CLAUDECODE`; everything else differs because the spawn CONTEXTS differ:

- `claudePtyRuntime` spawns a real Claude PTY, so nested-session detection is the
  concern → it strips the full marker set and adds terminal sizing. That marker
  set is ALREADY extracted as the `CLAUDE_PARENT_SESSION_ENV_KEYS` constant with a
  single consumer — one adapter, a hypothetical seam, nothing to move.
- `upgradeSelf` re-spawns the `happy` binary to self-upgrade — not a Claude
  session — so stripping only `CLAUDECODE` is the context-appropriate minimum, not
  a partial-coverage bug.
- The agent runs untrusted automation tasks, so secret-leak is its concern
  (`SERVER_INTERNAL_SECRETS`), and it lives in a package that cannot import CLI
  helpers anyway.

A shared `sanitizeChildEnv` would have to accept "which marker set", "add terminal
vars?", and "strip secrets?" flags — widening its interface to the union of all
three callers' policies (the shallow-module / ADR-0028 trap). The commonality is
one env var, not a shared behavior.

## Consequences

- The three sanitizers stay as they are. A future review seeing "three env
  sanitizers all deleting CLAUDECODE" should read this first: the shared surface is
  a single variable, and the surrounding policies are genuinely per-context.
- If the nested-session marker set ever needs a SECOND in-package consumer
  (e.g. another CLI site that also spawns Claude), that is when moving
  `CLAUDE_PARENT_SESSION_ENV_KEYS` to a shared module becomes a real two-adapter
  seam — not before.
