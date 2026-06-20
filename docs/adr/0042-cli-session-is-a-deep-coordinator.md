---
status: accepted
---

# The CLI `Session` class is a deep coordinator, not a shallow config dumping-ground

## Context

`packages/happy-cli/src/claude/session.ts` presents a wide surface at a glance: a ~17-field
constructor options object and several `readonly` fields (api, client, queue, env, args,
mcpServers, hook path, jsRuntime, model, two callbacks). An architecture review flagged it as
a "dumping ground" whose interface is as wide as its implementation — the shallow smell.

That read counts the *constructor* (config injection) and misses the *method* interface that
launchers (`claudeLocalLauncher`, `claudeRemoteLauncherCore`, `runClaude`) actually use, which
is small and owns real behaviour:

- **`onThinkingChange` / `onModeChange`** are not pass-throughs — they own the derived signal
  `client.keepAlive(thinking, mode, …)`: `Session` is the single owner of the `thinking + mode`
  state that the keepAlive heartbeat depends on, plus the 2s keepAlive interval lifecycle
  (started in the constructor, cleared in `cleanup`).
- **`onSessionFound` / `addSessionFoundCallback`** implement BehaviorSubject-style replay to
  late subscribers — a documented race fix (the SessionStart hook can fire before the scanner
  subscribes; without replay the scanner watches nothing). This invariant is load-bearing and
  non-obvious.
- **`consumeOneTimeFlags`** owns the `--resume`/`--continue` arg-filtering rules so a one-time
  flag isn't re-applied on the next turn.

## Decision

**Treat `Session` as a deep coordinator and leave its shape.** The wide constructor is config
injection (an options object), which is not the shallow smell; the runtime interface launchers
depend on is small and sits over genuinely larger implementation (keepAlive derivation, the
session-id replay invariant, flag consumption, interval lifecycle).

Deletion test: remove `Session` and its keepAlive-from-(thinking,mode) derivation, the
replay-to-late-subscribers semantics, and one-time-flag consumption scatter across `runClaude`
and the two launchers — complexity **concentrates** here, so it earns its keep.

## Consequences

- A future review that pattern-matches the wide constructor as a "dumping ground" should read
  this first: the depth is in the methods, not the field list. Splitting `Session` into smaller
  pieces would scatter the keepAlive/replay/flag invariants and make it *more* shallow, not less.
- If the constructor ever grows fields that no method reads (pure carry-through with no derived
  behaviour), revisit — that would be the real shallow smell.
