# Plan-mode 429 — investigation & mitigation

> **Status**: mitigation shipped in three layers (App picker → opt-in
> pre-sleep → reactive auto-retry). This document is referenced from
> several source-code comments; keep it in sync when the layers evolve.
>
> **Applies to**: happy-cli, Yolo / bypass-permissions sessions running
> against a self-hosted mirror of `ANTHROPIC_BASE_URL`
> (OneAPI / new-api / anthropic-proxy / similar).

## TL;DR

Every time a Yolo session exits plan mode, the cold-restart `--resume`
call that follows is one giant single request (whole conversation
history + tools list + freshly-emitted plan body). Self-hosted mirrors
routinely refuse it with 429 — either as `Upstream rate limit
exceeded` (per-minute TPM window) or as a synthesized 429 for
per-request tokens. Claude TUI's internal 10-attempt backoff burns
down inside one mirror-cooldown window and the turn ends with
`assistant.error === "rate_limit"`. On the official Anthropic API you
never see this because the API responds with a structured
`rate_limit_info` payload (`resetsAt`) that Claude TUI defers against;
mirrors don't emit that shape.

Three layers of defence, each independently useful:

1. **App picker cooldown** (default, no config) — Yolo's ExitPlanMode
   is routed through an App-side approval picker rather than the
   auto-approve hook, so the mirror's rate window has a chance to
   drain during the user's review. Effective when the user does not
   click approve within a few seconds.
2. **Opt-in pre-sleep** (`HAPPY_PLAN_RESTART_DELAY_MS`) — a fixed
   sleep before the PLAN_FAKE_RESTART prompt is written to the PTY.
   Blind but reliable; ideal for automation contexts where the App
   picker is not applicable.
3. **Reactive auto-retry** (default, no config) — after
   PLAN_FAKE_RESTART is sent and Claude TUI's internal 10-retry
   backoff still results in a `rate_limit` error, the launcher waits
   30/60/120 s and re-issues PLAN_FAKE_RESTART automatically, up to 3
   times. Behaves as if the user had manually typed "Continue" past
   the mirror cooldown.

## Symptom

A user on a self-hosted mirror in Yolo mode reports:

- After exiting plan mode, the TUI shows a red `429 / Upstream rate
  limit exceeded` error line.
- Claude TUI's internal retries flash by (visible as attempts 1..10)
  and all fail.
- The turn ends. The user has to interrupt and type "Continue" (or
  anything equivalent) to get the session moving again.
- All other prompts on the same session, before and after plan mode,
  succeed against the same mirror — this is **not** a general rate
  limit, it is specific to the ExitPlanMode continuation.

## Root cause

After ExitPlanMode we unshift `PLAN_FAKE_RESTART = "PlEaZe Continue
with plan."` and cold-restart Claude TUI with `--resume`. That
`--resume` call carries, in a single HTTP request:

- The entire session history (rewritten under a new sessionId — see
  `packages/happy-cli/CLAUDE.md` for the resume semantics).
- The full system prompt.
- The full tools list.
- The just-emitted plan body (often several thousand tokens).
- `PLAN_FAKE_RESTART` as the new user turn.

For a 2 M+ token accumulated session this comes out to hundreds of
thousands of input tokens on one wire, sent in one request. Ordinary
Anthropic infrastructure absorbs it (prompt caching + generous
per-request caps). Mirrors terminate the request locally, apply
whatever cap they were configured with, and 429 back — often without
the structured `rate_limit_info` payload that would tell Claude TUI
how long to wait. Claude TUI's own retry loop then retries at a much
shorter cadence than the mirror's cooldown window, exhausts its
budget, and surrenders.

The user's manual `Continue` succeeds because it starts a **new**
turn: a fresh HTTP connection past the mirror's now-drained cooldown
window, from the mirror's perspective effectively a new client.

## Mitigation layers

### Layer 1 — App picker cooldown (default)

`utils/exitPlanApproval.ts:shouldAutoApproveExitPlanInBypass()`
governs which PreToolUse hook is installed for Yolo sessions:

- `HAPPY_YOLO_EXIT_PLAN_AUTO_APPROVE=1|true` → classic
  `scripts/exit_plan_auto_approve.cjs`. Emits `permissionDecision:
  "allow"` immediately. Zero cooldown. Required for automation
  (agent_loop / webhook / scheduled runs) where no human is available.
- **Unset or anything else (default)** → new
  `scripts/exit_plan_approval_forwarder.cjs`. Blocking hook that POSTs
  to the local hookServer, which registers an approval request via
  `permissionHandler.registerExitPlanApproval` and pushes an entry
  onto `agentState.requests`. The App renders a picker; the hook
  stays blocked until the user clicks approve/reject. The blocking
  wait is a natural cooldown for the mirror.

**Effective when**: the human is available and takes more than a few
seconds to review. For a fast-click user, this alone is not enough.

**Code pointers**:

- `packages/happy-cli/src/claude/utils/exitPlanApproval.ts` — env-var read.
- `packages/happy-cli/src/claude/utils/mergeExitPlanAutoApproveIntoSettings.ts` — hook injection.
- `packages/happy-cli/src/claude/utils/startHookServer.ts` — `ExitPlanApproval` bridge.
- `packages/happy-cli/src/claude/runClaude.ts` — `onExitPlanApproval` callback that unshifts PLAN_FAKE_RESTART on approve.

### Layer 2 — Opt-in pre-sleep (`HAPPY_PLAN_RESTART_DELAY_MS`)

`maybeDelayPlanRestartWrite()` in `claudeRemote.ts` sleeps for a
configurable duration **before** writing PLAN_FAKE_RESTART to the
PTY. Zero by default (no cost on the official API). Opt in by
exporting `HAPPY_PLAN_RESTART_DELAY_MS=30000` (or higher). Clamped to
`[1, MAX_PLAN_RESTART_DELAY_MS=600_000]`; strict integer parse to
reject `"30s"` / `"30000ms"` / `"5.5"` etc. loudly instead of
silently degrading via `parseInt`.

Two production consumers, both in `claudeRemote.ts`:

- `:1635` — normal turn message pump, after the model hot-swap.
- `:1834` — cold-restart initial prompt.

Matching is `message.includes(PLAN_FAKE_RESTART)` rather than
strict equality: `MessageQueue2.collectBatch` joins same-modeHash
urgent items with `\n`, so the delivered string can be
`"PlEaZe Continue with plan.\n<sibling>"` when two unshifts coalesce.
An identity check would silently drop the throttle in that case.

**Effective when**: mirror cooldown is a predictable per-minute
window and the automation / user has already tuned the delay to it.
Blind but robust.

**Code pointers**:

- `packages/happy-cli/src/claude/claudeRemote.ts:308–345` —
  `maybeDelayPlanRestartWrite`.
- `packages/happy-cli/src/utils/sleepWithAbort.ts` — cancellable
  sleep shared by this layer and Layer 3.
- `packages/happy-cli/src/claude/maybeDelayPlanRestartWrite.test.ts`
  — regression coverage (message matching, env parse, upper clamp,
  AbortSignal).

### Layer 3 — Reactive auto-retry (default)

If a plan-continuation turn still ends with a `rate_limit` error
after Claude TUI's own 10-retry loop, the launcher **detects the
failure structurally** and re-issues PLAN_FAKE_RESTART on the user's
behalf. No config. Behaves as if the user had waited and typed
"Continue".

Detection point: `ClaudeJsonlAssistantMessage.error === "rate_limit"`
on any `assistant`-type JSONL record. This is authoritative — Claude
TUI writes the error field regardless of whether the mirror returned
a structured `rate_limit_info` payload. See
`jsonl/jsonlMessageTypes.ts:255–266` for the enum.

Decision function: `utils/planContinueRetryPolicy.ts:decidePlanContinueRetry`.
Pure state → decision; unit-tested end-to-end without any timers or
queue mocking.

Retry ladder (1-indexed attempt):

| attempt | delay |
|---|---|
| 1 | 30 s |
| 2 | 60 s |
| 3 | 120 s |

Total worst-case wait: 210 s ≈ 3.5 min. Aligned with Anthropic's
60 s rolling window while giving mirrors room to breathe; well under
the user's manual "wait then send Continue" turnaround.

Scope guards baked into the policy:

- **Only continuation turns are retried.** Ordinary user prompts hit
  by 429 are left to Claude TUI's native backoff (double-retrying
  would duplicate work and confuse the model with two "continue"
  prompts). Gated on `currentTurnIsPlanContinue` — set when the
  launcher consumes a msg with `source ∈ {"exit-plan-continue",
  "exit-plan-retry"}`.
- **A turn that produces non-rate-limit output disarms the auto-
  retry.** If the model emitted any real text / tool_use / thinking
  before the rate_limit error arrived, the user has already seen a
  partial response. Silently re-issuing PLAN_FAKE_RESTART would
  double-consume. Mirrors strand recovery's `rearmRedeliverBudget`
  semantics.
- **Budget exhausted → give up.** After 3 retries all failing, the
  launcher pings `keepAlive` one last time with `attempt: 3/3` so
  the App state bar shows a terminal state instead of leaving the
  last "waiting X s" hanging. CLI stays silent — the TUI's red 429
  line is what the user sees; they can `/compact` and try again.

**User-visible progress**: `session.client.keepAlive` with the same
shape used by `api_retry` (`attempt / maxRetries / retryDelayMs /
errorStatus`). The App already renders this UI; nothing new to
build.

**Abort behaviour**: `sleepWithAbort` listens to the launcher's
`abortController.signal`. A user stop / teardown mid-sleep resolves
the promise on the next tick, and the abort-check right after the
sleep bails out before the re-unshift so nothing leaks into the next
session.

**Code pointers**:

- `packages/happy-cli/src/claude/utils/planContinueRetryPolicy.ts` — pure decision.
- `packages/happy-cli/src/claude/utils/planContinueRetryPolicy.test.ts` — 11 policy cases.
- `packages/happy-cli/src/claude/claudeRemoteLauncherCore.ts` — three integration hooks:
  1. State declarations next to `planModeLockdownActive`.
  2. Turn-start marker in the `msg.source` consumption path (extended to recognise `"exit-plan-retry"`).
  3. `onMessage` branch handling `assistant.error === "rate_limit"` and the rearm on non-error assistant content.
- `packages/happy-cli/src/utils/sleepWithAbort.ts` + tests.

## How the three layers interact

The layers compose additively; there is no "pick one" configuration
decision.

```
ExitPlanMode observed
        │
        ▼
  ┌───────────────────────────────────┐
  │ Layer 1: PreToolUse hook          │
  │  auto-approve?  →  YES  →  route  │
  │                             direct│
  │  auto-approve?  →  NO   →  block  │
  │                             on App│
  │                             picker│
  └───────────────────────────────────┘
        │
        ▼  (approval eventually granted)
  PLAN_FAKE_RESTART unshifted
        │
        ▼
  ┌───────────────────────────────────┐
  │ Layer 2: pre-write sleep          │
  │  HAPPY_PLAN_RESTART_DELAY_MS > 0? │
  │                             sleep │
  └───────────────────────────────────┘
        │
        ▼
  Cold-restart --resume, first model call
        │
        ├─ succeeds → normal flow ────────────► done
        │
        └─ rate_limit (after TUI's own 10 retries)
                      │
                      ▼
              ┌─────────────────────────────────────┐
              │ Layer 3: reactive auto-retry        │
              │   attempt < 3?                      │
              │     yes → sleep 30/60/120 s,        │
              │            re-unshift as            │
              │            source=exit-plan-retry ──┘ (back to Cold-restart)
              │     no  → keepAlive final ping, quit│
              └─────────────────────────────────────┘
```

## Non-goals & known limits

- **We do not scrape the TUI screen.** All three layers rely on JSONL
  structured signals (`error`, `terminal_reason`, `rate_limit_info`).
  Screen text is theatre, not source of truth.
- **We do not shrink the payload.** The `--resume` request stays huge
  by design. The right fix for that is `/compact` before ExitPlanMode
  — surfaced to the user in Layer 3's give-up ping.
- **We do not retry across turns that already produced output.** If
  the model streamed anything real before the mirror gave up, the
  auto-retry is disarmed. The user sees the partial response and
  decides for themselves.
- **We do not handle `error: "overloaded"` (529)** here. Separate
  issue with different semantics; would require its own scoping
  discussion before adding to Layer 3's policy.
- **Mirror-specific 429 shapes** (missing `rate_limit_info`, custom
  reset headers) are opaque to us. We defer conservatively on the
  ladder rather than reading a `resetsAt` we cannot trust.

## Regression tests

| Test file | Locks in |
|---|---|
| `maybeDelayPlanRestartWrite.test.ts` | Layer 2 env parse, upper clamp, AbortSignal, batched-siblings match |
| `sleepWithAbort.test.ts` | Cancellable sleep across pre-aborted / mid-abort / no-signal shapes |
| `planContinueRetryPolicy.test.ts` | Layer 3 decision cases (non-continuation → no-op, produced-output → no-op, ladder 30/60/120, budget exhausted, defensive clamps) |
| `exitPlanApproval.test.ts` | Layer 1 env-var gate for auto-approve vs App picker |
| `permissionHandlerExitPlan.test.ts` | Layer 1 unshift semantics and PLAN_FAKE_RESTART routing |

## Future work

- A **per-mirror probe** at session start: send a small canary request
  and read the mirror's response headers to detect its rate-limit
  shape (per-request cap vs per-minute TPM vs opaque), then tune
  Layer 2's default without user config.
- A **`/compact`-on-give-up nudge**: after Layer 3 exhausts, unshift
  a small App-visible advisory (not a Claude prompt) recommending
  `/compact`. Held off in the initial ship to avoid surprising users
  with an autofire message; revisit with product.
- A **shared cooldown record** between the CLI and the daemon so
  Layer 3's ladder resets can be observed cross-session; useful if
  the same mirror is being hit by parallel sessions.
