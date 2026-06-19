---
status: accepted
---

# Task route project/profile/directory resolution stays caller-owned; no "authorization-context" seam

## Context

Four paths create a dispatched **Task** through `taskCreate.ts` (the **Task intake**
seam): manual `POST /v1/tasks`, `POST /v1/tasks/:id/retry`, swarm re-dispatch, and the
inbound `WebhookTrigger`. Read side by side, each opens with a visually similar dance:
load the **Project** (when one is bound), pull `project.supervisorConfig`, decide the
working **directory**, resolve the runtime **AiBackendProfile**, and on profile-resolution
failure send an error response. An architecture review flagged this as a candidate for a
single deep "authorization-context" seam — "given a Task request, return the verified
Machine + Project + directory + resolved profile in one call."

On close reading the four dances are **not the same operation wearing four hats**; they
vary in exactly the pieces CONTEXT.md's **Task intake** entry already names as
caller-owned:

- **Project-load policy differs.** Manual/retry use `ownedProject` (throws 404 on a
  missing Project); webhook uses a silent `findFirst` that *tolerates* a deleted Project
  (directory falls back to `~`); swarm uses `ownedProject` inside a `try/catch` that skips
  project-specific config. Folding these into one loader would force one missing-Project
  policy onto callers that deliberately disagree.
- **Directory policy differs.** Manual validates an override is under `project.path` and
  persists it on the row; retry defaults to `project.path` only when the row has none;
  webhook/cron leave the column null and carry the directory in the dispatch payload only.
- **Profile-failure action differs.** Manual → HTTP 400, webhook → HTTP 503 (+ the
  external caller must fix and retry), swarm → best-effort silent fallback, cron → skip the
  iteration. This is the `400/503/skip` split CONTEXT.md calls out explicitly.

The genuinely invariant, non-varying pieces — the runtime-profile resolution *protocol*
(`resolveTaskRuntimeProfile` / `…BestEffort` + `taskProfileFields`), skill loading, the
Task row shape (`buildTaskCreateData`), and the `task-trigger` dispatch payload
(`dispatchTaskTrigger`) — **already live deep in `taskCreate.ts`**. What looked like a
missing seam is mostly the caller-owned variance the intake design intentionally left at the
call site.

## Decision

**Do not build a unified Task-route authorization-context seam.** Keep project-load policy,
directory policy, and profile-failure action at each call site, as the Task intake decision
prescribes. The only piece that was genuinely duplicated with *no* variance — the
profile-unavailable response **body** `{ error: "profile_unavailable", reason, message }`,
repeated verbatim across manual (400), retry (400), and webhook (503) — is single-sourced
as `profileUnavailableBody(failure)` in `taskCreate.ts`. The HTTP **status code** stays
caller-owned; only the body shape is shared.

## Considered options

- *Extract `resolveTaskDispatchContext(machineId, projectId?, directoryOverride?, …)`
  returning verified Machine + Project + directory + profile.* Rejected: to serve all four
  callers it would have to absorb the three caller-owned policies above, so its interface
  would carry a flag for each variance (missing-Project policy, directory policy,
  failure-as-value-vs-throw). The result is a module whose **interface is as complex as the
  implementation** — a shallow seam — and it would contradict the Task intake decision in
  CONTEXT.md. The residual shared lines (`supervisorConfig` threading is one line; the
  project is already loaded by the caller for its directory policy) are too thin to earn a
  seam.
- *Leave the profile-unavailable body inline at all three sites.* Rejected: that body is a
  wire contract with zero variance across the strict callers; a field added in one place
  would silently drift from the others. Single-sourcing it is a real (if small) locality win.

## Consequences

- A future architecture review proposing "unify the Task route project/profile/directory
  resolution" should read this first: the variance is deliberate and documented, and the
  shared invariant pieces are already concentrated in `taskCreate.ts`.
- If a *fifth* trigger path lands whose policies match an existing one exactly (e.g. a second
  cron-like path that also skips on failure), that is the signal to extract a *narrow* helper
  shared by just those matching callers — not the broad seam rejected here.
