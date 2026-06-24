import { render } from "ink";
import { Session } from "./session";
import { MessageBuffer } from "@/ui/ink/messageBuffer";
import { RemoteModeDisplay } from "@/ui/ink/RemoteModeDisplay";
import React from "react";
import { claudeRemote, is1MModelKey, isSlashCommand } from "./claudeRemote";
import {
  classifyStrandTick,
  classifyOutputTick,
  DEFAULT_STRAND_THRESHOLDS,
} from "./strandPolicy";
import { mapToClaudeMode } from "./utils/permissionMode";
import { PermissionHandler } from "./utils/permissionHandler";
import { Future } from "@/utils/future";
import { ClaudeJsonlAssistantMessage, ClaudeJsonlMessage, ClaudeJsonlUserMessage } from "./jsonl";
import { forkSession } from "@/claude/rpc/sessionStoreRpc";
import type { ElicitationRequest, ElicitationResult } from "./jsonl/types";
import type {
  ClaudeJsonlStatusMessage as ClaudeJsonlStatusMsg,
  ClaudeJsonlCompactBoundaryMessage as ClaudeJsonlCompactMsg,
  ClaudeJsonlTaskStartedMessage,
  ClaudeJsonlTaskProgressMessage,
  ClaudeJsonlTaskUpdatedMessage,
  ClaudeJsonlTaskNotificationMessage,
  ClaudeJsonlAPIRetryMessage,
  ClaudeJsonlToolProgressMessage,
  ClaudeJsonlPromptSuggestionMessage,
  ClaudeJsonlSessionStateChangedMessage,
  ClaudeJsonlMemoryRecallMessage,
  ClaudeJsonlRateLimitEvent,
} from "@/claude/jsonl";
import type { ClaudePtyController } from "@/claude/pty/claudePtyController";
import { startHappyServer } from "@/claude/utils/startHappyServer";
import {
  buildHappyMcpServers,
  type HappyMcpServerEntry,
} from "@/claude/utils/generateHookSettings";
import { formatClaudeMessageForInk } from "@/ui/messageFormatterInk";
import { logger } from "@/ui/logger";
import { ClaudeJsonlToLogConverter } from "./utils/jsonlToLogConverter";
import {
  mapStreamEventToEnvelope,
  createStreamEventMapperState,
  type StreamEventMapperState,
} from "./utils/streamEventMapper";
import { PLAN_FAKE_REJECT, PLAN_FAKE_RESTART } from "./jsonl/prompts";
import {
  markDisabledMcpServers,
  readClaudeDisabledMcpServers,
  readClaudeMcpServers,
  readClaudePluginMcpServers,
} from "@/claude/utils/claudeSettings";
import { fetchMcpRegistryServers } from "@/claude/utils/mcpRegistryReader";
import { notifyDaemonSessionFault } from "@/daemon/controlClient";
import { EnhancedMode } from "./loop";
import { createSessionEventReporter } from "./sessionEventReporter";
import { tryRegisterCompactBoundaryEmission } from "./compactBoundaryDedup";
import { extractCompactSummary } from "./compactSummaryParser";
import { hashObject } from "@/utils/deterministicJson";
import { getProjectPath } from "./utils/path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { executeShellCommand } from "@/utils/shellCommand";
import { TurnCollector, generateRepoMap } from "@/knowledge";
import type { TurnCollectorConfig } from "@/knowledge";
import { applyHappyProgressUpdate } from "@/utils/happyProgressMetadata";
import { TaskMirrorState } from "@/utils/taskMirrorState";
import {
  buildAutoSummarySyntheticPrompt,
  HAPPY_AUTO_SUMMARY_SOURCE,
} from "@/utils/progressAutomation";
import { ExecutionGuard } from "@/automation/ExecutionGuard";
import {
  buildProgressStateFromLists,
  capProgressLists,
} from "@/utils/progressState";
import {
  registerClaudeControlHandlers,
  SessionCostTracker,
} from "./rpc/claudeControlHandlers";
import { createAppliedSettingsState } from "./utils/applyFlagSettings";
import { createMcpServerState } from "./utils/mcpServerManager";
import packageJson from "../../package.json";
import { createContextDetailRpcHandler } from "./contextDetailRpc";
import {
  buildWorldConfigPrefix,
  extractKnowledgeHints,
  extractTags,
  formatKnowledgeForInjection,
  inferEntryType,
} from "./remoteKnowledgeHelpers";
import { OutgoingMessageQueue } from "./utils/OutgoingMessageQueue";

interface PermissionsField {
  date: number;
  result: "approved" | "denied";
  mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto";
  allowedTools?: string[];
}

/**
 * Helper function to create a session protocol message envelope
 */
function buildProtocolMessage(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    type,
    ...payload,
  };
}

export async function claudeRemoteLauncher(
  session: Session,
): Promise<"switch" | "exit"> {
  logger.debug("[claudeRemoteLauncher] Starting remote launcher");

  // Check if we have a TTY for UI rendering
  const hasTTY = process.stdout.isTTY && process.stdin.isTTY;
  logger.debug(`[claudeRemoteLauncher] TTY available: ${hasTTY}`);

  // Configure terminal
  let messageBuffer = new MessageBuffer();
  let inkInstance: any = null;

  if (hasTTY) {
    console.clear();
    inkInstance = render(
      React.createElement(RemoteModeDisplay, {
        messageBuffer,
        logPath: process.env.DEBUG ? session.logPath : undefined,
        onExit: async () => {
          // Exit the entire client
          logger.debug("[remote]: Exiting client via Ctrl-C");
          if (!exitReason) {
            exitReason = "exit";
          }
          await abort();
        },
        onSwitchToLocal: () => {
          // Switch to local mode
          logger.debug("[remote]: Switching to local mode via double space");
          doSwitch();
        },
      }),
      {
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
  }

  if (hasTTY) {
    process.stdin.resume();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding("utf8");
  }

  // Handle abort
  let exitReason: "switch" | "exit" | null = null;
  let abortController: AbortController | null = null;
  let abortFuture: Future<void> | null = null;
  // Set just before the strand watchdog's tier-2 cold-restart abort() so the
  // post-abort branch can report an auto-recovery instead of a user abort —
  // the watchdog aborts the very same controller a manual stop does.
  let strandColdRestart = false;
  const executionGuard = new ExecutionGuard(({ from, to }) => {
    logger.debug(
      `[remote]: execution guard ${from.state} -> ${to.state}${to.activeReason ? ` (${to.activeReason})` : ""} [gen=${to.generation}]`,
    );
  });
  let activeTurnGeneration: number | null = null;

  // ── Stranded-turn watchdog + auto-recovery (#122 PTY-migration hang) ──
  // A turn can wedge so the Claude TUI neither writes its `turn_duration`
  // marker (so handleResult → updateThinking(false) never fires) nor exits
  // (so claudeRemote's exit `finally` — the other updateThinking(false) —
  // never runs). claudeRemote stays parked on `await exitPromise`, the
  // ExecutionGuard stays "running", and the 2s keep-alive heartbeat keeps
  // broadcasting thinking=true: the App spinner spins forever and the next
  // user message is held client-side ("running → queue, don't send"), so
  // resending never helps and only a manual restart recovers.
  //
  // The watchdog detects this — PTY silent past a threshold while the guard
  // is still "running" and no tool / elicitation explains the silence — and
  // drives two-tier recovery (see recoverStrandedTurn).
  //
  // Liveness is measured by lastClaudeOutputAt, refreshed by raw PTY byte
  // activity (onPtyActivity) AND parsed JSONL messages (onMessage). The PTY
  // signal is the load-bearing one: the TUI's animated spinner emits bytes at
  // sub-second cadence the entire time Claude is genuinely working — including
  // pure pre-first-token thinking (Opus xhigh on a large context) and MCP-tool
  // phases that write no JSONL — and goes silent only once the turn has ended
  // or the PTY wedged. Relying on onMessage alone (the original bug) made a
  // slow first token indistinguishable from a strand, so the watchdog aborted
  // legitimately-thinking turns — surfacing as a spurious "Aborted by user".
  // Grep `[remote][strand]` for activity.
  let lastClaudeOutputAt = Date.now();
  let turnWatchdog: ReturnType<typeof setInterval> | null = null;
  let writeVerifyTimer: ReturnType<typeof setTimeout> | null = null;
  let strandRecoveryInFlight = false;
  let lastColdRestartAt = 0;
  const WATCHDOG_TICK_MS = 20_000;
  // Strand thresholds + the per-tick decision policy live in strandPolicy.ts
  // (single source of truth, carrying the full incident rationale for each
  // number). The watchdog here owns only the timer cadence + the recovery
  // mechanics below.
  const strandThresholds = DEFAULT_STRAND_THRESHOLDS;
  // Post-write submission-wedge check (armed at the moment each prompt is
  // written, see onPromptWritten). A normal submit echoes the pasted prompt
  // back as raw PTY bytes within milliseconds; a wedge produces zero echo and
  // zero output. This catches a wedge in ~2.5s — far faster than the 20s-tick
  // watchdog above — by reusing the same proven Esc+re-deliver recovery.
  const WRITE_VERIFY_MS = 2_500;
  const STRAND_TIER1_GRACE_MS = 10_000; // wait after interrupt before tier-2
  const MIN_COLD_RESTART_INTERVAL_MS = 300_000; // rate-limit tier-2 restarts

  // ── Stranded-turn auto-redelivery ──
  // A turn can wedge the Claude TUI the instant the prompt is written: the
  // prompt sits unsubmitted in the composer, the TUI emits zero bytes, and
  // nothing ever runs (observed in 2026-05-27-23-53-39-pid-36115.log gen=5 —
  // 0 PTY bytes, 0 JSONL records for the whole turn). The watchdog's tier-1
  // Esc unwedges the PTY, but Esc CLEARS the Claude TUI composer — so the
  // prompt the user sent is discarded and lost forever. Symptom: "I sent a
  // message and got no reaction." (Distinct from the false-positive abort the
  // PTY-byte liveness signal fixed: there the turn was alive; here it genuinely
  // never started.)
  //
  // Fix: retain the in-flight prompt so a tier-1 recovery that finds the turn
  // produced ZERO output can re-push it onto the queue. The still-running
  // mid-turn drain (a tier-1-only recovery never stops it) takes the re-pushed
  // message — its mode is identical so the cold-hash check passes — and writes
  // it to the now-responsive PTY via midTurnPushFn. Bounded to ONE consecutive
  // auto-retry (`strandRedeliverCount`, reset by any genuine output) so a
  // persistently wedged session escalates to tier-2 instead of re-strand
  // looping. Gating on zero output is what makes re-delivery double-execution
  // safe: no JSONL record means nothing ran.
  let inFlightPrompt: {
    message: string;
    mode: EnhancedMode;
    /**
     * Queue `source` of the message that produced this write — propagated
     * from the queue item via `nextPromptSource` so `maybeRedeliverStranded
     * Prompt` (and other consumers) can branch on origin. Pre-0.100.7 this
     * field also gated the auto-compact internal isolate; that path is
     * gone (hint-only via runClaude's onAutoCompactRequest), so the field
     * is currently only consumed by the permission-handler PLAN_FAKE_RESTART
     * source and still useful for future tagged isolates.
     */
    source?: string;
  } | null = null;
  /**
   * Source of the message most recently returned from `nextMessage()`, used
   * to stamp `inFlightPrompt.source` inside `onPromptWritten`. Set at every
   * return site in the launcher's `nextMessage` implementation; read once
   * per turn after `claudeRemote` writes the bracketed paste to the PTY.
   */
  let nextPromptSource: string | undefined = undefined;
  let turnProducedOutput = false;
  // Echo-confirmation latch — flipped true once the post-write WRITE_VERIFY
  // check observes PTY echo / output after the bracketed-paste write, proving
  // the TUI actually consumed the prompt (a real case-(a) submission wedge
  // produces zero echo, leaving this false and getting caught by WRITE_VERIFY
  // in 2.5s). The 45s elapsed-based strand check below gates on
  // `!promptSubmissionConfirmed` so legitimate slow first tokens — Opus 4.x
  // 超高 thinking in particular, where the spinner keeps the PTY alive
  // (idleMs<90s) but no JSONL arrives for 60-90s — do NOT get aborted just
  // because the wall-clock crossed 45s. Without this, the 45s path
  // (introduced in c36211a75) misreads extended-thinking as case-(a) wedge,
  // re-delivers mid-thought, and surfaces as the "No response after 60s —
  // re-sending your message…" loop the user observed.
  let promptSubmissionConfirmed = false;
  let strandRedeliverCount = 0;
  // Wall-clock when the current watchdog started (= turn start). Used to
  // measure total elapsed thinking time independent of lastClaudeOutputAt,
  // which a live PTY spinner keeps refreshing — masking deep extended-thinking
  // hangs from the existing idle-based strand detector.
  let turnStartedAt = 0;
  // Cold-restart grace window: when nextMessage() returns a `pending` message
  // (the PLAN_FAKE_RESTART / isolate-slash / mode-change cold-swap path), the
  // new PTY is spawned with --resume and Claude TUI creates a NEW session file
  // with a fresh sessionId (per happy-cli/CLAUDE.md "Claude Session Resume
  // Behavior"). sessionScanner sees all historical messages as new and syncs
  // a burst into onMessage within ~600ms (observed in pid-42129 log; ~200
  // records at spawn+500ms). Those replays are NOT this turn's real output —
  // if we let them flip turnProducedOutput, a subsequent submission wedge
  // (TUI never commits the continuation prompt) is masked from the 90s
  // fast-wedge path AND blocks the maybeRedeliverStrandedPrompt guard, so
  // recovery stalls until the generic 120s idle path and the lost prompt is
  // never re-delivered (user-visible: 138s freeze + silent message loss).
  // 5s gives ~8x margin over the observed burst length while staying well
  // under the 90s wedge threshold; a turn genuinely streaming refreshes
  // lastClaudeOutputAt via PTY bytes the whole time so the grace window
  // can never cause a false-positive recovery.
  let coldRestartGraceUntil = 0;
  const COLD_RESTART_GRACE_MS = 5_000;

  const strandDiagState = (): string => {
    const snap = executionGuard.getSnapshot();
    return (
      `guard=${snap.state} gen=${snap.generation} activeGen=${activeTurnGeneration} ` +
      `idle=${Date.now() - lastClaudeOutputAt}ms ongoingTools=${ongoingToolCalls.size} ` +
      `pendingElicit=${pendingElicitations.size}`
    );
  };

  function startTurnWatchdog(): void {
    stopTurnWatchdog();
    // A fresh turn's silence clock starts when its watchdog (re)starts — it
    // must NOT inherit lastClaudeOutputAt from the previous turn's last PTY
    // output. Between turns the user can sit idle for minutes (lastClaudeOutputAt
    // freezes since onMessage stops firing), so without this reset the watchdog
    // counts that inter-turn idle as *this* turn's PTY silence. Combined with a
    // slow first token (e.g. Opus high-reasoning on a large context), the strand
    // detector then aborts the just-started turn — surfacing to the user as a
    // spurious "Aborted by user" the moment the turn begins.
    lastClaudeOutputAt = Date.now();
    turnStartedAt = Date.now();
    turnWatchdog = setInterval(() => {
      const snap = executionGuard.getSnapshot();
      if (snap.state !== "running") return;
      // Skip legitimate long waits: an active tool (e.g. a slow Bash) or a
      // pending MCP elicitation explains the silence without being a strand.
      if (ongoingToolCalls.size > 0 || pendingElicitations.size > 0) return;
      const idleMs = Date.now() - lastClaudeOutputAt;
      const elapsedMs = Date.now() - turnStartedAt;
      const inFlightIsSlashCommand =
        !!inFlightPrompt && isSlashCommand(inFlightPrompt.message);

      // Decide what this tick means. The threshold branching + the full
      // incident rationale for every number live in strandPolicy.classifyStrandTick
      // (pure + unit-tested); here we only apply the decision — the greppable
      // `[remote][strand]` diagnostics, the user-facing re-send event, and the
      // recovery trigger.
      const decision = classifyStrandTick(
        {
          idleMs,
          elapsedMs,
          turnProducedOutput,
          promptSubmissionConfirmed,
          inFlightIsSlashCommand,
          strandRecoveryInFlight,
        },
        strandThresholds,
      );

      if (decision.action === "none") return;

      if (decision.action === "warn") {
        if (decision.kind === "slash-holdoff") {
          logger.debug(
            `[remote][strand] slash command in flight (${inFlightPrompt!.message.trim().slice(0, 40)}) — PTY silent ${idleMs}ms (legitimate for /compact etc.), holding off recovery until ${strandThresholds.slashCommandRecoverMs}ms. ${strandDiagState()}`,
          );
        } else {
          logger.debug(
            `[remote][strand] turn appears stranded — PTY silent ${idleMs}ms while guard running. ${strandDiagState()}`,
          );
        }
        return;
      }

      // decision.action === "recover" — log per kind, then trigger recovery.
      switch (decision.kind) {
        case "slash":
          logger.debug(
            `[remote][strand] slash command (${inFlightPrompt!.message.trim().slice(0, 40)}) silent ${idleMs}ms past ${strandThresholds.slashCommandRecoverMs}ms threshold — starting auto-recovery. ${strandDiagState()}`,
          );
          break;
        case "wedge":
          logger.debug(
            `[remote][strand] zero-output submission wedge — PTY silent ${idleMs}ms since turn start, fast auto-recovery. ${strandDiagState()}`,
          );
          break;
        case "elapsed-wedge":
          logger.debug(
            `[remote][strand] no JSONL output ${elapsedMs}ms after turn start (PTY spinner may be active) — likely a dropped submission or hung API. Forcing recovery. ${strandDiagState()}`,
          );
          // Pre-0.100.7 this branched on `source === "auto-compact"` to print a
          // separate "Auto-compact stalled / pausing" copy; the auto-push is
          // gone (hint-only path) so every stalled prompt is now a real user
          // message and the unconditional re-send copy tells the truth.
          session.client.sendSessionEvent({
            type: "message",
            message: `No response after ${decision.notifyUserSeconds}s — re-sending your message…`,
          });
          break;
        case "idle":
          logger.debug(
            `[remote][strand] PTY silent ${idleMs}ms while guard running — starting auto-recovery. ${strandDiagState()}`,
          );
          break;
      }
      void recoverStrandedTurn(decision.basisMs);
    }, WATCHDOG_TICK_MS);
    if (typeof turnWatchdog.unref === "function") turnWatchdog.unref();
  }

  function stopTurnWatchdog(): void {
    if (turnWatchdog) {
      clearInterval(turnWatchdog);
      turnWatchdog = null;
    }
  }

  // Cancel a pending post-write wedge check — the turn has produced output, the
  // turn ended, or recovery is taking over. Cheap and idempotent.
  function clearWriteVerify(): void {
    if (writeVerifyTimer) {
      clearTimeout(writeVerifyTimer);
      writeVerifyTimer = null;
    }
  }

  // Two-tier recovery for a confirmed strand (driven by the watchdog above).
  //
  // Tier 1 — graceful interrupt via doInterrupt(): currentQuery.interrupt()
  //   writes Esc to the PTY (reaching the wrapped controller.interrupt in
  //   claudeRemote.ts, which fires updateThinking(false)) and finishTurn()
  //   reconciles the guard. The Esc write + updateThinking(false) do NOT
  //   depend on the wedged TUI reacting, so this alone clears the App
  //   spinner and unblocks client-side sending. If the TUI honours the Esc
  //   it resumes printing — lastClaudeOutputAt advances past `interruptAt`.
  //
  // Tier 2 — if the PTY stays silent through the grace window the TUI is
  //   truly wedged (the next message would strand too), so abort() the
  //   controller and let `while (!exitReason)` cold-restart a fresh PTY.
  //   claudeRemote's exit `finally` guarantees updateThinking(false) on the
  //   way out. Rate-limited so a persistently broken session can't thrash.
  async function recoverStrandedTurn(idleMs: number): Promise<void> {
    if (strandRecoveryInFlight || exitReason) return;
    strandRecoveryInFlight = true;
    const interruptAt = Date.now();
    try {
      const idleSec = Math.round(idleMs / 1000);
      logger.debug(
        `[remote][strand] auto-recovery tier-1 (graceful interrupt) after ${idleMs}ms PTY silence. ${strandDiagState()}`,
      );
      // Surface tier-1 attempt to the user so they know something is happening
      // rather than staring at an unresponsive chat indefinitely.
      session.client.sendSessionEvent({
        type: "message",
        message: `No response for ${idleSec}s — attempting recovery…`,
      });
      await doInterrupt();
      await new Promise<void>((resolve) =>
        setTimeout(resolve, STRAND_TIER1_GRACE_MS),
      );
      if (exitReason || lastClaudeOutputAt > interruptAt) {
        logger.debug(
          "[remote][strand] auto-recovery tier-1 succeeded — PTY responsive again.",
        );
        maybeRedeliverStrandedPrompt();
        return;
      }
      if (Date.now() - lastColdRestartAt < MIN_COLD_RESTART_INTERVAL_MS) {
        logger.debug(
          "[remote][strand] tier-1 ineffective but tier-2 cold restart suppressed (rate limit) — spinner already cleared, will retry next window.",
        );
        session.client.sendSessionEvent({
          type: "message",
          message: "Recovery attempt finished — session unblocked (restart suppressed by rate limit).",
        });
        return;
      }
      logger.debug(
        `[remote][strand] tier-1 ineffective — escalating to tier-2 cold restart. ${strandDiagState()}`,
      );
      session.client.sendSessionEvent({
        type: "message",
        message: "Recovery attempt failed — restarting session process…",
      });
      lastColdRestartAt = Date.now();
      strandColdRestart = true;
      await abort();
    } catch (e) {
      logger.debug(
        `[remote][strand] auto-recovery threw: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      strandRecoveryInFlight = false;
    }
  }

  // Re-deliver the in-flight prompt after a tier-1 recovery that unwedged a PTY
  // whose turn produced nothing. The recovery Esc cleared the TUI composer, so
  // the prompt is gone; re-pushing it lets the still-running mid-turn drain type
  // it onto the now-responsive PTY. Skipped when the turn produced output (the
  // prompt actually ran — re-delivering would double-execute), when nothing is
  // in flight, or when the one-shot budget is already spent (the next strand
  // escalates to tier-2 instead of re-strand looping). `urgent` priority jumps
  // any backlog so the lost prompt runs before later sends.
  function maybeRedeliverStrandedPrompt(): void {
    if (exitReason || turnProducedOutput || !inFlightPrompt) return;
    // Pre-0.100.7 we additionally skipped redeliver when `source ===
    // "auto-compact"` (the threshold handler used to push `/compact` here)
    // and armed a cooldown latch from inside this branch. The auto-push is
    // gone — every in-flight prompt is now a real user message — so the
    // skip is unconditionally the wrong choice and the cooldown nothing
    // observes it.
    if (strandRedeliverCount >= 1) {
      logger.debug(
        "[remote][strand] stranded prompt already re-delivered once — not retrying (next strand escalates to tier-2).",
      );
      return;
    }
    strandRedeliverCount++;
    const { message, mode } = inFlightPrompt;

    // Slash commands (`/compact`, `/clear`, `/model …`) cannot be safely
    // re-pasted onto the same PTY. The tier-1 Esc does not reliably clear
    // the TUI composer in every state — vim NORMAL mode, mid-turn drain
    // races, and Ink raw-mode reattach can leave the original paste
    // partially in the composer. Re-pasting `/compact` onto a composer
    // that still contains `/compact` yields `/compact/compact`, which is
    // not a valid slash command — the TUI silently treats it as prose,
    // `compact_boundary` never fires, and the user sees only "Compaction
    // started" followed by a long silence (see the symptom screenshot
    // that motivated this fix). For prose the same concat is recoverable
    // (it just gets typed twice), but for slash commands the command
    // itself is destroyed.
    //
    // Force a tier-2 cold restart instead: the new PTY's composer is
    // guaranteed empty, and the queue-pushed slash command lands cleanly
    // as the first prompt of the new launch iteration.
    if (isSlashCommand(message)) {
      logger.debug(
        `[remote][strand] in-flight prompt is slash command (${message.trim().slice(0, 40)}) — forcing cold restart instead of paste redeliver to avoid composer concat`,
      );
      session.client.sendSessionEvent({
        type: "message",
        message: "Session recovered — restarting to safely resend slash command…",
      });
      // Push the slash command back onto the queue so the post-restart
      // launch iteration picks it up via nextMessage(). urgent priority
      // keeps it ahead of any backlog the user accumulated during the
      // wedge window.
      session.queue.push(message, mode, undefined, {
        priority: "urgent",
        kind: "prompt",
        source: "strand-redeliver-coldrestart",
      });
      inFlightPrompt = null;
      lastColdRestartAt = Date.now();
      strandColdRestart = true;
      // Fire-and-forget abort — the await in the outer launch loop will
      // unwind, finally runs, and the while(!exitReason) loop spawns a
      // fresh PTY. We deliberately do NOT await here because
      // recoverStrandedTurn's finally needs to clear strandRecoveryInFlight
      // before the next iteration's watchdog ticks.
      void abort();
      return;
    }

    logger.debug(
      `[remote][strand] re-delivering stranded prompt (turn produced 0 output, attempt ${strandRedeliverCount}) — ${message.length} chars`,
    );
    session.client.sendSessionEvent({
      type: "message",
      message: "Session recovered — resending your message…",
    });
    session.queue.push(message, mode, undefined, {
      priority: "urgent",
      kind: "prompt",
      source: "strand-redeliver",
    });
    // Hand-off complete — the queue now owns this prompt. Clear the capture
    // so a subsequent recover in the same turn (before onPromptWritten
    // re-stamps for the redelivered prompt) cannot re-push the same text a
    // second time. strandRedeliverCount already guards against this, but
    // clearing the capture makes the lifecycle explicit at zero cost.
    inFlightPrompt = null;
  }

  const dispatchTurn = (reason: "user_message" | "continue" | "isolated_command" | "mode_change") => {
    // Fresh turn — its "did anything run?" flag starts false. The first JSONL
    // record (onMessage) flips it true; a strand recovery reads it to decide
    // whether the prompt was lost and must be re-delivered.
    turnProducedOutput = false;
    // Fresh turn — clear the echo-confirmation latch too. WRITE_VERIFY will
    // re-arm it once it sees PTY echo for the new prompt; until then the 45s
    // elapsed-based strand check stays armed in case the prompt never lands.
    promptSubmissionConfirmed = false;
    // Fresh turn — drop any prior turn's captured prompt. onPromptWritten
    // will re-stamp inFlightPrompt once the new turn's bracketed paste
    // lands on the PTY. Without this, a recover triggered between
    // dispatchTurn and onPromptWritten (e.g. a stale watchdog tick on the
    // newly-reserved "running" guard) could see the OLD inFlightPrompt and
    // re-deliver the previous turn's prompt against the new turn. The
    // turnProducedOutput guard does not fully cover this — it is also reset
    // to false above, so the guard alone cannot distinguish "no output yet
    // because prompt hasn't been written" from "no output yet because
    // submission wedge".
    inFlightPrompt = null;
    if (!executionGuard.reserve(reason)) {
      const snapshot = executionGuard.getSnapshot();
      logger.debug(
        `[remote]: execution guard reserve skipped (state=${snapshot.state}, gen=${snapshot.generation})`,
      );
      // claudeRemote only asks for the next message after the previous turn
      // has drained, so a lingering "running" state here means the prior
      // turn's finishTurn() never fired — e.g. a PTY-mode interrupt, which
      // stops the TUI but emits no turn-complete event. Left as-is, start()
      // below returns null on a "running" guard, activeTurnGeneration keeps
      // pointing at the dead generation, and the dequeued message still gets
      // typed into the PTY with no turn lifecycle: it renders but never
      // executes (the "sends content but doesn't run" hang). Reconcile the
      // stale generation so start() can open a fresh turn. We only touch
      // "running" — "restarting"/"interrupting" already let start() proceed
      // and are relied on by the plan-mode continue path.
      if (snapshot.state === "running" && activeTurnGeneration !== null) {
        logger.debug(
          `[remote][strand] reconciling stranded turn — force-ending stale gen=${activeTurnGeneration} (no onTurnComplete before next message). ${strandDiagState()}`,
        );
        executionGuard.end(activeTurnGeneration);
        activeTurnGeneration = null;
      }
    }
    const generation = executionGuard.start();
    if (generation !== null) {
      activeTurnGeneration = generation;
      startTurnWatchdog();
    }
  };

  const finishTurn = () => {
    stopTurnWatchdog();
    clearWriteVerify();
    if (activeTurnGeneration === null) {
      executionGuard.cancelReservation();
      return;
    }
    if (executionGuard.end(activeTurnGeneration)) {
      activeTurnGeneration = null;
    }
  };

  const reasonForQueuedMessage = (msg: { isolate?: boolean; mode: EnhancedMode }) => {
    if (msg.isolate) return "isolated_command" as const;
    if (msg.mode.continue) return "continue" as const;
    return "user_message" as const;
  };

  async function abort() {
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }
    await abortFuture?.promise;
  }

  async function doAbort() {
    logger.debug("[remote]: doAbort");
    // Reset live mode tracking back to configured defaults — see Session.onAbort.
    // Idempotent; safe to call alongside doSwitch.
    session.onAbort();
    executionGuard.abort("abort");
    await abort();
  }

  async function doSwitch() {
    logger.debug("[remote]: doSwitch");
    session.onAbort();
    executionGuard.abort("switch_transport");
    if (!exitReason) {
      exitReason = "switch";
    }
    await abort();
  }

  // Track current PTY controller for runtime control (interrupt, stopTask).
  // Most methods are stub no-ops (TUI has no equivalent) — see ClaudePtyController.
  let currentQuery: ClaudePtyController | null = null;
  // Knowledge base: turn-level data collection + injection
  // Default ON — collection runs silently in background (minimal overhead).
  // App setting `knowledgeBase` controls Tab visibility; env HAPPY_KNOWLEDGE_BASE=false to fully disable.
  const knowledgeEnabled = process.env.HAPPY_KNOWLEDGE_BASE !== "false";
  const turnCollectorConfig: Partial<TurnCollectorConfig> = {};
  const rawSensitivity = process.env.HAPPY_KNOWLEDGE_SENSITIVITY;
  if (rawSensitivity === "conservative" || rawSensitivity === "balanced" || rawSensitivity === "aggressive") {
    turnCollectorConfig.sensitivity = rawSensitivity;
  }
  if (process.env.HAPPY_KNOWLEDGE_TRACK_FILE_EDITS !== undefined) {
    turnCollectorConfig.trackFileEdits = process.env.HAPPY_KNOWLEDGE_TRACK_FILE_EDITS !== "false";
  }
  const turnCollector = knowledgeEnabled ? new TurnCollector(turnCollectorConfig) : null;
  let knowledgeInjected = false; // Track whether knowledge was already injected
  let knowledgeContext: string | null = null; // Cached knowledge for system prompt
  let worldConfig: { narrative: string; laws: string; policy: string } | null = null;
  let worldConfigInjected = false;
  let pendingKnowledgeRefresh = false; // Whether a per-turn refresh is pending
  // Injected knowledge entries (id → metadata). Used both for dedup and for per-turn hit detection.
  let knowledgeEntries = new Map<string, { id: string; title: string; tags: string[] }>();
  let pendingFileHint: string | null = null; // File-based knowledge hint for next message
  let currentTurnFilePaths = new Set<string>(); // Files edited in the current turn

  // Sync server-side knowledgeConfig to TurnCollector at runtime
  let summaryEnabled = true;
  function syncKnowledgeConfig(cfg: {
    sensitivity?: string;
    trackFileEdits?: boolean;
    trackTokens?: boolean;
    summaryEnabled?: boolean;
  } | undefined): void {
    if (!cfg || !turnCollector) return;
    const patch: Partial<TurnCollectorConfig> = {};
    if (cfg.sensitivity === "conservative" || cfg.sensitivity === "balanced" || cfg.sensitivity === "aggressive") {
      patch.sensitivity = cfg.sensitivity;
    }
    if (cfg.trackFileEdits !== undefined) patch.trackFileEdits = cfg.trackFileEdits;
    if (cfg.trackTokens !== undefined) patch.trackTokens = cfg.trackTokens;
    if (cfg.summaryEnabled !== undefined) summaryEnabled = cfg.summaryEnabled;
    if (Object.keys(patch).length > 0) {
      turnCollector.updateConfig(patch);
    }
  }

  // Pre-fetch global world config (narrative/laws) for injection (non-blocking).
  // Gated by knowledgeEnabled: world-config is part of the knowledge-base feature
  // and should not generate any server requests when the user has disabled it.
  if (knowledgeEnabled) {
    session.client.fetchWorldConfig().then((cfg) => {
      if (cfg && (cfg.narrative || cfg.laws)) {
        worldConfig = cfg;
        logger.debug(`[world-config] Loaded narrative=${!!cfg.narrative}, laws=${!!cfg.laws}`);
      }
    }).catch(() => {});
  }

  // Pre-fetch knowledge context for injection (non-blocking)
  if (knowledgeEnabled) {
    const mode = (process.env.HAPPY_KNOWLEDGE_MODE as "auto" | "full" | "minimal") || "auto";
    session.client.fetchKnowledge(mode).then((result) => {
      if (result && (result.profile || result.entries.length > 0)) {
        knowledgeContext = formatKnowledgeForInjection(result);
        for (const e of result.entries) {
          knowledgeEntries.set(e.id, { id: e.id, title: e.title, tags: e.tags });
        }
        logger.debug(`[knowledge] Pre-fetched context: ${knowledgeContext!.length} chars, ${result.entries.length} entries`);
      }
      syncKnowledgeConfig(result?.knowledgeConfig);
    }).catch((err) => {
      logger.debug(`[knowledge] Failed to pre-fetch: ${err}`);
    });
  }

  // Non-blocking: generate and submit repo map on session start so the knowledge
  // base has an up-to-date file-tree snapshot. Server consolidate handles dedup.
  if (knowledgeEnabled) {
    generateRepoMap(session.path).then((mapResult) => {
      if (mapResult.success) {
        const dirName = session.path.split("/").filter(Boolean).pop() ?? "project";
        session.client.submitKnowledge({
          entryType: "repo_map",
          contributorType: "session",
          action: "create",
          title: `Repo Map: ${dirName}`,
          content: mapResult.content,
          tags: ["repo-map", "codebase-structure"],
          confidence: "high",
          affectedFiles: mapResult.affectedFiles,
        });
        logger.debug(`[repo-map] Submitted repo map for ${dirName} (${mapResult.affectedFiles.length} files)`);
      }
    }).catch((err) => {
      logger.debug(`[repo-map] Failed to generate repo map: ${err}`);
    });
  }

  // Project CONTEXT.md: load once per session for injection into the first message.
  // File lives at <workingDir>/.happy/CONTEXT.md — created by the user or via the App.
  let contextMdContent: string | null = null;
  let contextMdInjected = false;
  readFile(join(session.path, ".happy", "CONTEXT.md"), "utf-8").then((content) => {
    const trimmed = content.trim();
    if (trimmed) {
      contextMdContent = trimmed;
      logger.debug(`[context] Loaded project CONTEXT.md: ${contextMdContent.length} chars`);
    }
  }).catch(() => {
    // File doesn't exist — no context injection
  });

  async function doInterrupt() {
    logger.debug("[remote]: doInterrupt — graceful interrupt via PTY");
    if (currentQuery) {
      try {
        await currentQuery.interrupt();
        // A PTY interrupt stops the TUI mid-turn but never emits a
        // turn-complete event, so onTurnComplete()/finishTurn() would not
        // fire on its own and the execution guard would stay "running" on the
        // interrupted generation. Reconcile it here so the next message can
        // reserve a fresh turn instead of being skipped (and silently typed
        // into the PTY without ever executing).
        finishTurn();
      } catch (e) {
        logger.debug("[remote]: interrupt() threw — falling back to abort", e);
        await abort();
      }
    } else {
      logger.debug("[remote]: no active query — falling back to abort");
      await abort();
    }
  }

  async function doStopTask(args: { taskId: string }) {
    logger.debug(`[remote]: doStopTask — taskId=${args.taskId}`);
    if (!args.taskId) return;

    // PTY mode has no programmatic stopTask — Claude TUI manages subagent
    // lifetime internally. We can only ack the App-visible state by emitting
    // a task-end envelope so the App's task list clears.
    const envelope = buildProtocolMessage("agent", {
      t: "task-end",
      taskId: args.taskId,
      status: "stopped" as const,
      summary: "Task stopped by user",
    });
    session.client.sendSessionProtocolMessage(envelope as any);
  }

  async function doBackgroundTasks(args: { toolUseId?: string }) {
    // PTY mode has no programmatic background-task inspection. Return false
    // so the App treats the move-to-background request as not-implemented.
    //
    // Note: the corresponding UI button was removed from happy-app in 2.31.0
    // (commit removing AgentInput Background Tasks button). This handler is
    // retained as a no-op stub so older App builds calling the RPC still get
    // a clean { success: false } response instead of an "unknown RPC" error.
    logger.debug(`[remote]: doBackgroundTasks — toolUseId=${args.toolUseId ?? "all"} (no PTY equivalent)`);
    return { success: false };
  }

  // When to abort
  session.client.rpcHandlerManager.registerHandler("abort", doAbort); // When abort clicked
  session.client.rpcHandlerManager.registerHandler("switch", doSwitch); // When switch clicked
  session.client.rpcHandlerManager.registerHandler("interrupt", doInterrupt); // Graceful interrupt
  session.client.rpcHandlerManager.registerHandler("stopTask", doStopTask); // Stop background task
  session.client.rpcHandlerManager.registerHandler("backgroundTasks", doBackgroundTasks); // Move foreground tasks to background

  // Claude Control sidebar RPCs (SDK 0.2.119+ — see claudeControlRpc.ts wire schemas)
  const sessionCostTracker = new SessionCostTracker();
  const appliedSettingsState = createAppliedSettingsState();
  const mcpServerState = createMcpServerState();
  // Mutable, shared MCP server map: filled in by runClaudeOnce just before
  // claudeRemote() is called, then mutated in place by toggle_mcp_server so
  // the PTY controller's live getter surfaces the new `disabled` flag on the
  // App's next mcpServerStatus() poll without a session restart.
  const liveMcpServers: Record<string, unknown> = {};
  registerClaudeControlHandlers({
    rpcHandlerManager: session.client.rpcHandlerManager,
    getCurrentQuery: () => currentQuery,
    cwd: session.path,
    costTracker: sessionCostTracker,
    happyCliVersion: (packageJson as { version?: string }).version,
    appliedSettingsState,
    mcpServerState,
    liveMcpServers,
  });
  // Removed catch-all stdin handler - now handled by RemoteModeDisplay keyboard handlers

  // Task log streaming: subscribe/unsubscribe to real-time output file monitoring
  session.client.rpcHandlerManager.registerHandler(
    "subscribeTaskLog",
    async (args: { taskId: string; outputFile: string }) => {
      const { startWatching, isWatching } = await import("@/modules/taskLog/taskLogWatcher");
      if (isWatching(args.taskId)) {
        return { ok: true, already: true };
      }
      startWatching(args.taskId, args.outputFile, (chunk) => {
        session.client.emitTaskLog(chunk.taskId, chunk.outputFile, chunk.chunk, chunk.offset);
      });
      return { ok: true };
    },
  );
  session.client.rpcHandlerManager.registerHandler(
    "unsubscribeTaskLog",
    async (args: { taskId: string }) => {
      const { stopWatching } = await import("@/modules/taskLog/taskLogWatcher");
      stopWatching(args.taskId);
      return { ok: true };
    },
  );

  // I/O wrapper around `extractCompactSummary` (compactSummaryParser.ts).
  // The pure parser is the source of truth for the record-selection rule;
  // this function only handles file resolution + read-error swallowing so
  // callers degrade gracefully when the JSONL hasn't materialised yet.
  async function readLatestSummaryFromJsonl(
    sessionId: string,
    boundaryUuid?: string,
  ): Promise<string | null> {
    try {
      const projectDir = getProjectPath(session.path);
      const filePath = join(projectDir, `${sessionId}.jsonl`);
      const content = await readFile(filePath, "utf-8");
      return extractCompactSummary(content, boundaryUuid);
    } catch {
      return null;
    }
  }

  // After a `compact_boundary` JSONL record fires, the TUI writes the
  // `isCompactSummary:true` user record next to it — but the file flush
  // can lag the in-memory boundary event by milliseconds-to-seconds. Poll
  // briefly so the user-visible event lands shortly after the boundary
  // without racing the write. Returns the summary text suitable for an
  // emit-as-event, or null when no matching summary materializes within
  // the budget.
  async function pollForCompactionSummary(
    sessionId: string,
    boundaryUuid: string,
    sinceSummaryHash: string | null,
  ): Promise<string | null> {
    const POLL_INTERVAL_MS = 250;
    const MAX_POLL_MS = 8_000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < MAX_POLL_MS) {
      const summary = await readLatestSummaryFromJsonl(sessionId, boundaryUuid);
      if (summary && summary !== sinceSummaryHash) {
        return summary;
      }
      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return null;
  }

  // Snapshot of the most recently emitted compaction summary, used to
  // distinguish "new summary just written by THIS /compact" from "summary
  // already present from a prior /compact" (so we don't re-emit on a
  // boundary that produced no new summary record).
  let lastEmittedCompactionSummary: string | null = null;

  // Uuid-keyed dedup state for `compact_boundary` replays. The actual
  // once-per-uuid logic lives in `compactBoundaryDedup.ts` so the rule has a
  // single test surface; the closure just owns the Set's lifetime (launcher
  // instance scope, cleared implicitly on process exit). See that module's
  // docblock for the cold-restart replay rationale.
  const emittedCompactBoundaryUuids = new Set<string>();

  // Register RPC handler to allow App to fetch the latest compaction summary
  // In remote mode, read from the JSONL file on demand (no scanner available).
  // Delegates to readLatestSummaryFromJsonl so the RPC path and the
  // post-boundary auto-emit path share the same source-of-truth parser
  // (handles both the PTY `isCompactSummary:true` user record and the legacy
  // SDK `type:"summary"` record).
  session.client.rpcHandlerManager.registerHandler(
    "getCompactionSummary",
    async () => {
      const currentSessionId = session.sessionId;
      if (!currentSessionId) {
        return { summary: null };
      }
      const summary = await readLatestSummaryFromJsonl(currentSessionId);
      return { summary };
    },
  );

  session.client.rpcHandlerManager.registerHandler(
    "claude-control:get_context_detail",
    createContextDetailRpcHandler({
      getCurrentSessionId: () => session.sessionId,
      cwd: session.path,
    }),
  );

  // Register RPC handler for App to fetch plan file content
  session.client.rpcHandlerManager.registerHandler(
    "getPlanFileContent",
    async () => {
      if (!latestPlanFilePath) {
        return { content: null, filePath: null };
      }
      try {
        const content = await readFile(latestPlanFilePath, "utf-8");
        return { content, filePath: latestPlanFilePath };
      } catch {
        // File write may still be in progress — fall back to cached content
        return { content: latestPlanContent, filePath: latestPlanFilePath };
      }
    },
  );

  // Register RPC handler for forking a session at a specific message
  session.client.rpcHandlerManager.registerHandler(
    "forkSession",
    async (args: { upToMessageId?: string; title?: string }) => {
      const claudeSessionId = session.sessionId;
      if (!claudeSessionId) {
        return { error: "No active Claude session to fork" };
      }
      // Validate args — only accept strings
      const upToMessageId = typeof args.upToMessageId === "string" ? args.upToMessageId : undefined;
      const title = typeof args.title === "string" ? args.title : undefined;
      try {
        const result = await forkSession(claudeSessionId, {
          upToMessageId,
          title,
          dir: session.path,
        });
        logger.debug(
          `[remote]: forked session ${claudeSessionId} → ${result.sessionId}`,
        );

        // Copy the latest compaction summary from the source session JSONL
        // into the forked JSONL so getCompactionSummary works on the fork.
        // We write the legacy SDK `type:"summary"` shape into the fork because
        // it's the lowest-common-denominator shape that BOTH the PTY-path
        // reader and the SDK-path scanner recognise — synthesising the full
        // PTY `isCompactSummary:true` user record would require fabricating a
        // valid parentUuid that the fork session doesn't have.
        try {
          const projectDir = getProjectPath(session.path);
          const latestSummary = await readLatestSummaryFromJsonl(claudeSessionId);
          if (latestSummary) {
            const forkFile = join(projectDir, `${result.sessionId}.jsonl`);
            const summaryRecord = JSON.stringify({ type: "summary", summary: latestSummary });
            await writeFile(forkFile, "\n" + summaryRecord + "\n", { flag: "a" });
            logger.debug("[remote]: copied compaction summary to fork JSONL");
          }
        } catch (copyErr) {
          logger.debug(`[remote]: failed to copy summary to fork: ${copyErr}`);
        }

        return {
          claudeSessionId: result.sessionId,
          path: session.path,
        };
      } catch (err) {
        logger.debug(`[remote]: forkSession failed: ${err}`);
        return {
          error: err instanceof Error ? err.message : "Fork failed",
        };
      }
    },
  );

  // seedReadState had no PTY equivalent — the SDK-only read-cache pre-warm
  // was retired with the SDK runtime. Kept as an ack-only handler so older
  // App builds that still send the RPC don't see an "unknown handler" error.
  session.client.rpcHandlerManager.registerHandler(
    "seedReadState",
    async (args: { path: string; mtime: number }) => {
      logger.debug(`[remote]: seedReadState(${args.path}, ${args.mtime}) — no PTY equivalent`);
      return { success: true };
    },
  );

  // Create permission handler
  const permissionHandler = new PermissionHandler(session);

  // Drop any permission requests left over in agent state from a
  // previous CLI process that died while a tool prompt was open. The
  // in-memory pendingRequests map is fresh and empty, but the server
  // still has `requests: { [id]: {...} }` and the app shows a spinner
  // + "Permission required" banner that no click can clear — the
  // previous process is gone and the new one has no record of the id.
  // reset() moves any stale entries to completedRequests with status
  // 'canceled' so the UI reflects what actually happened.
  permissionHandler.reset('Previous CLI process exited before responding');

  // Create outgoing message queue
  const messageQueue = new OutgoingMessageQueue((logMessage) =>
    session.client.sendClaudeSessionMessage(logMessage),
  );

  // Set up callback to release delayed messages when permission is requested
  permissionHandler.setOnPermissionRequest((toolCallId: string) => {
    messageQueue.releaseToolCall(toolCallId);
  });

  // Create SDK to Log converter (pass responses from permissions)
  const jsonlToLogConverter = new ClaudeJsonlToLogConverter(
    {
      sessionId: session.sessionId || "unknown",
      cwd: session.path,
      version: process.env.npm_package_version,
    },
    permissionHandler.getResponses(),
  );

  // Session timeline event reporter (fire-and-forget to server).
  // getSessionId is called lazily so new sessions work even before Claude
  // assigns a session ID at launcher startup.
  const reportSessionEvent = session.onSessionEvent
    ? createSessionEventReporter(
        { sessionEvent: session.onSessionEvent },
        () => session.client.sessionId,
      )
    : null;

  // Handle messages
  let planModeToolCalls = new Set<string>();
  let latestPlanFilePath: string | null = null;
  let latestPlanContent: string | null = null;
  let ongoingToolCalls = new Map<string, { parentToolCallId: string | null }>();
  let lastResultData: {
    totalCostUsd: number;
    numTurns: number;
    modelUsage: Record<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
        costUSD: number;
        contextWindow: number;
        maxOutputTokens: number;
      }
    >;
  } | null = null;

  // Perf tracking: end-to-end timing from socket to first assistant response
  let _perfTurnSocketReceivedAt: number | undefined;
  let _perfTurnFirstResponseLogged = false;
  // Tracks TaskCreate/TaskUpdate tool calls from Claude Code runtime
  // (Opus 4.6+) and converts them to TodoWrite-compatible progress mirror.
  const taskMirrorState = new TaskMirrorState();

  // Stream event mapper state — reset per query cycle.
  let streamEventState: StreamEventMapperState = createStreamEventMapperState();

  /**
   * Plan-mode lockdown flag for `yolo` (bypassPermissions) sessions.
   *
   * Bug it fixes: starting Claude TUI with `--dangerously-skip-permissions`
   * short-circuits every permission check, so even after the assistant
   * calls `EnterPlanMode` the plan-mode "read-only" contract is purely
   * advisory. We've observed Opus 4.7 (session 6a885a93… and earlier)
   * sidestep `ExitPlanMode` entirely by `Write`-ing the plan markdown
   * straight to `~/.claude/plans/*.md` and then going idle, which leaves
   * the App's review UI stuck on `honking…` forever — no picker, no
   * approval keystroke, no progress.
   *
   * Mitigation: when EnterPlanMode is observed in bypass mode, set this
   * flag and cold-restart Claude TUI. The next spawn runs `claudeRemote`
   * with `planModeLockdown=true`, which appends `Write/Edit/MultiEdit/
   * NotebookEdit/Bash` to `disallowedTools` — a hard deny that even
   * `--dangerously-skip-permissions` cannot override. With those tools
   * unavailable, the model has to use `ExitPlanMode` to deliver the
   * plan, which is auto-approved by the PreToolUse allow-hook that
   * `claudeRemote` injects while this flag is set (see
   * mergeExitPlanAutoApproveIntoSettings). After the tool is approved we
   * clear the flag and cold-restart again so the rest of the session
   * keeps the full Yolo toolset.
   *
   * Declared at launcher scope (outside the cold-restart `while` loop)
   * so the value survives the cold restarts it drives. `onMessage` and
   * `coldModeHash` both close over it.
   */
  let planModeLockdownActive = false;

  function onMessage(message: ClaudeJsonlMessage) {
    // A parsed JSONL message is one liveness source for the stranded-turn
    // watchdog (the load-bearing one is raw PTY byte activity — see
    // onPtyActivity and the watchdog block). Refresh the silence clock.
    lastClaudeOutputAt = Date.now();
    // Any JSONL record proves the turn actually ran — so a strand recovery
    // must NOT re-deliver its prompt (it wasn't lost), and the session is
    // healthy enough to re-arm the one-shot auto-redelivery budget.
    //
    // Exception: within the cold-restart grace window an arriving JSONL is
    // most likely a sessionScanner replay of pre-existing history (Claude
    // TUI rewrites the session file with a fresh sessionId on --resume, so
    // every historical message looks "new" to the scanner). Don't flip
    // turnProducedOutput inside the window — if the PTY then goes silent
    // past WATCHDOG_WEDGE_RECOVER_MS the 90s wedge path can still trip AND
    // maybeRedeliverStrandedPrompt can still re-push the lost continuation
    // prompt. A turn genuinely streaming refreshes lastClaudeOutputAt via
    // PTY bytes regardless, so suppressing the flag here cannot cause a
    // false-positive recovery. See coldRestartGraceUntil declaration.
    // The cold-restart-grace invariant (replays inside the window are NOT this
    // turn's output, and must not refund the redeliver budget) lives in the
    // pure `classifyOutputTick` policy, pinned by strandPolicy.test.ts. See its
    // doc + the `coldRestartGraceUntil` declaration for the incident rationale.
    const outputEffect = classifyOutputTick(Date.now(), coldRestartGraceUntil);
    if (outputEffect.countAsTurnOutput) {
      turnProducedOutput = true;
    }
    if (outputEffect.rearmRedeliverBudget) {
      strandRedeliverCount = 0;
    }
    clearWriteVerify();
    // ── Stream events (partial messages) → text-delta envelopes ────────
    // Intercept before the rest of the pipeline. stream_event messages
    // carry raw API SSE chunks (text_delta, thinking_delta) that are
    // too granular for the JSONL log but perfect for real-time App UI.
    if (message.type === "stream_event") {
      // Ensure a turn exists before sending text-delta envelopes.
      // Stream events can arrive before the full assistant message that
      // normally creates the turn via ensureTurn(). Without a turn the App
      // drops agent envelopes (typesRaw.ts guard), causing empty responses.
      const turnId = session.client.ensureCurrentTurn();
      const envelope = mapStreamEventToEnvelope(
        message as unknown as Parameters<typeof mapStreamEventToEnvelope>[0],
        streamEventState,
        turnId,
      );
      if (envelope) {
        logger.debug(`[stream] text-delta envelope → turn=${turnId}, delta=${JSON.stringify(envelope).slice(0, 200)}`);
        session.client.sendSessionProtocolMessage(envelope as any);
      } else {
        const evt = (message as any).event;
        logger.debug(`[stream] no envelope for event type=${evt?.type}, delta.type=${evt?.delta?.type}`);
      }
      return; // Don't pass stream events through the rest of the pipeline
    }

    // End-to-end perf: log total latency on first assistant response per turn
    if (!_perfTurnFirstResponseLogged && message.type === "assistant" && _perfTurnSocketReceivedAt) {
      _perfTurnFirstResponseLogged = true;
      const e2e = Date.now() - _perfTurnSocketReceivedAt;
      logger.debug(`[perf] E2E socket_received → first_assistant: ${e2e}ms`);
    }

    // Fold result messages into the session-cost tracker so the claude-control
    // `get_session_cost` RPC returns real values instead of zero. See
    // claudeControlHandlers.ts for the aggregation semantics.
    if (message.type === "result") {
      sessionCostTracker.recordResult(message);
    }

    // Write to message log
    formatClaudeMessageForInk(message, messageBuffer);

    // Write to permission handler for tool id resolving
    permissionHandler.onMessage(message);

    // Knowledge base: collect turn data from SDK messages
    // Wrapped in try-catch to never interfere with message processing
    try {
      if (turnCollector) {
        if (message.type === "user") {
          const uMsg = message as ClaudeJsonlUserMessage;
          const content = uMsg.message?.content;
          let text = "";
          if (typeof content === "string") {
            text = content;
          } else if (Array.isArray(content)) {
            text = content
              .filter((c: any) => c.type === "text" && typeof c.text === "string")
              .map((c: any) => c.text)
              .join("\n");
          }
          if (text) {
            turnCollector.collectUserMessage(text);
          }
        }
        if (message.type === "assistant") {
          const aMsg = message as ClaudeJsonlAssistantMessage;
          if (aMsg.message.content && Array.isArray(aMsg.message.content)) {
            for (const c of aMsg.message.content) {
              if (c.type === "text") {
                turnCollector.collectAssistantText(c.text);
              }
              if (c.type === "tool_use") {
                turnCollector.collectToolCall();
                if (c.name === "Write" || c.name === "Edit") {
                  const filePath = (c.input as Record<string, unknown>)?.file_path;
                  if (typeof filePath === "string") {
                    turnCollector.collectFileEdit(filePath, c.name === "Write" ? "create" : "edit");
                    currentTurnFilePaths.add(filePath);
                  }
                }
              }
            }
          }
        }
      }
    } catch (err) {
      logger.debug(`[knowledge] Error collecting turn data: ${err}`);
    }

    // Auto-mirror TaskCreate/TaskUpdate → metadata.progress.
    // Claude Code (Opus 4.6+) replaced SDK-native TodoWrite with runtime
    // TaskCreate/TaskUpdate tools. These don't produce the oldTodos/newTodos
    // shaped tool_use_result, so we track state from assistant tool_use blocks.
    if (message.type === "assistant") {
      try {
        const aMsg = message as ClaudeJsonlAssistantMessage;
        if (aMsg.message.content && Array.isArray(aMsg.message.content)) {
          let taskMirrorChanged = false;
          for (const c of aMsg.message.content) {
            if (
              c.type === "tool_use" &&
              (c.name === "TaskCreate" || c.name === "TaskUpdate" || c.name === "TaskList") &&
              c.input &&
              typeof c.input === "object"
            ) {
              const changed = taskMirrorState.processToolUse(
                c.name,
                c.input as Record<string, unknown>,
                c.id as string | undefined,
              );
              if (changed) taskMirrorChanged = true;
            }
          }
          if (taskMirrorChanged && taskMirrorState.hasTasks()) {
            const todos = taskMirrorState.getTodos();
            let shouldTriggerAutoSummary = false;
            session.client.updateMetadata((m) => {
              const result = applyHappyProgressUpdate(m, { todos });
              shouldTriggerAutoSummary = result.shouldTriggerAutoSummary;
              return result.metadata;
            });
            if (shouldTriggerAutoSummary) {
              logger.debug("[task-mirror] Checklist completed, triggering auto-summary");
              session.client.sendSyntheticUserMessage(buildAutoSummarySyntheticPrompt(), {
                displayText: "",
                sentFrom: HAPPY_AUTO_SUMMARY_SOURCE,
              });
            }
          }
        }
      } catch (err) {
        logger.debug(`[task-mirror] Error mirroring TaskCreate/TaskUpdate: ${err}`);
      }
    }

    // Freeze the prior TaskCreate/TaskUpdate batch at fresh user-turn
    // boundaries. The Claude runtime keeps completed tasks alive forever,
    // so without this step a new turn's TaskCreate would emit the union of
    // every past task plus the new one — the consumer's Jaccard overlap
    // check would see near-full overlap and append to the prior progress
    // list instead of starting a new one. Freezing once all of the current
    // batch is `completed` makes the next TaskCreate emit a fresh slice
    // and the consumer's boundary detection takes over from there. We key
    // off "user message without a tool_use_result" — that's a real prompt
    // (synthetic auto-summary/progress prompts included; benign there
    // because they don't drive TaskCreate).
    if (message.type === "user") {
      try {
        const uMsg = message as ClaudeJsonlUserMessage;
        const content = uMsg.message?.content;
        const hasToolResultBlock =
          Array.isArray(content) &&
          content.some((block) => {
            const b = block as unknown as Record<string, unknown>;
            return b?.type === "tool_result";
          });
        if (uMsg.tool_use_result === undefined && !hasToolResultBlock) {
          taskMirrorState.freezeCompletedBatch();
        }
      } catch (err) {
        logger.debug(`[task-mirror] Error checking turn boundary: ${err}`);
      }
    }

    // Auto-mirror TodoWrite → metadata.progress. Reads SDK-native
    // `TodoWriteOutput` off `user.tool_use_result` (shape: oldTodos, newTodos,
    // verificationNudgeNeeded). Boundary detection = content-set intersection
    // of oldTodos vs newTodos: zero overlap → start a new list. This survives
    // the case where the prior list still has in_progress/pending items when
    // the agent pivots to a brand-new topic (which the old priorAllDone gate
    // silently overwrote).
    if (message.type === "user") {
      try {
        const uMsg = message as ClaudeJsonlUserMessage;
        const rawResult = uMsg.tool_use_result;
        if (rawResult && typeof rawResult === "object") {
          const r = rawResult as Record<string, unknown>;
          const oldRaw = r.oldTodos;
          const newRaw = r.newTodos;
          if (Array.isArray(oldRaw) && Array.isArray(newRaw)) {
            type MirroredTodo = {
              content: string;
              status: "pending" | "in_progress" | "completed";
              activeForm?: string;
              verificationNudgeNeeded?: boolean;
            };
            const sanitize = (list: readonly unknown[]): MirroredTodo[] => {
              const out: MirroredTodo[] = [];
              for (const item of list) {
                if (!item || typeof item !== "object") continue;
                const rec = item as Record<string, unknown>;
                const content = rec.content;
                const status = rec.status;
                if (typeof content !== "string" || content.length === 0) continue;
                if (
                  status !== "pending" &&
                  status !== "in_progress" &&
                  status !== "completed"
                )
                  continue;
                const activeForm = rec.activeForm;
                out.push({
                  content,
                  status,
                  activeForm:
                    typeof activeForm === "string" && activeForm.length > 0
                      ? activeForm
                      : undefined,
                });
              }
              return out;
            };
            const oldTodos = sanitize(oldRaw);
            const newTodos = sanitize(newRaw);
            if (newTodos.length > 0) {
              const verificationNudgeNeeded = r.verificationNudgeNeeded === true;
              const mirrored: MirroredTodo[] = verificationNudgeNeeded
                ? newTodos.map((t) =>
                    t.status === "completed"
                      ? { ...t, verificationNudgeNeeded: true }
                      : t,
                  )
                : newTodos;

              // Detect the "list fully completed" transition BEFORE calling
              // updateMetadata. The updater handler runs inside an async lock
              // and wouldn't give us a synchronous result — so we snapshot
              // the current metadata via getMetadata() and compute everything
              // we need here. The handler below then consumes the flag via
              // closure to stamp `summaryGeneratedAt`.
              const currentMetadataSnapshot = session.client.getMetadata();
              const priorProgressSnapshot = currentMetadataSnapshot?.progress;
              const priorListsSnapshot = priorProgressSnapshot?.lists ?? [];
              const priorCurrentIdSnapshot = priorProgressSnapshot?.currentListId;
              const priorCurrentListSnapshot = priorCurrentIdSnapshot
                ? priorListsSnapshot.find((l) => l.id === priorCurrentIdSnapshot)
                : undefined;
              const oldKeysSnapshot = new Set(
                oldTodos.map((t) => t.content),
              );
              const newKeysSnapshot = new Set(
                mirrored.map((t) => t.content),
              );
              let intersectionSnapshot = 0;
              for (const k of newKeysSnapshot)
                if (oldKeysSnapshot.has(k)) intersectionSnapshot += 1;
              const isBoundarySnapshot =
                oldKeysSnapshot.size === 0 ||
                intersectionSnapshot === 0 ||
                !priorCurrentListSnapshot;

              let shouldTriggerAutoSummary = false;
              if (!isBoundarySnapshot) {
                const oldHadIncomplete = oldTodos.some(
                  (t) => t.status !== "completed",
                );
                const newAllCompleted =
                  mirrored.length > 0 &&
                  mirrored.every((t) => t.status === "completed");
                const alreadyStamped =
                  priorCurrentListSnapshot?.summaryGeneratedAt !== undefined;
                shouldTriggerAutoSummary =
                  oldHadIncomplete && newAllCompleted && !alreadyStamped;
              }

              session.client.updateMetadata((m) => {
                const now = Date.now();
                const prior = m.progress;
                const lists = prior?.lists ? [...prior.lists] : [];
                const currentId = prior?.currentListId;
                const currentIdx = currentId
                  ? lists.findIndex((l) => l.id === currentId)
                  : -1;
                const currentList = currentIdx >= 0 ? lists[currentIdx] : undefined;

                // Boundary: SDK oldTodos and newTodos share zero content.
                // oldTodos empty (first TodoWrite) also counts as boundary so
                // we always allocate a list on the first mirror.
                const oldKeys = new Set(oldTodos.map((t) => t.content));
                const newKeys = new Set(mirrored.map((t) => t.content));
                let intersection = 0;
                for (const k of newKeys) if (oldKeys.has(k)) intersection += 1;
                const isBoundary = oldKeys.size === 0 || intersection === 0;
                logger.debug(
                  `[progress-mirror] ${mirrored.length} todos (boundary=${isBoundary ? "yes" : "no"}, old=${oldTodos.length}, intersect=${intersection})`,
                );

                const label = mirrored[0]?.content;

                let nextLists = lists;
                let nextCurrentId = currentId;

                if (isBoundary || currentIdx < 0) {
                  // Archive prior list (if any, even with un-completed items
                  // — preserves last-known state in history), start fresh.
                  if (currentIdx >= 0 && currentList) {
                    nextLists = lists.map((l, i) =>
                      i === currentIdx ? { ...l, archivedAt: now } : l,
                    );
                  }
                  const newId = randomUUID();
                  nextLists = [
                    ...nextLists,
                    {
                      id: newId,
                      label,
                      todos: mirrored,
                      startedAt: now,
                      updatedAt: now,
                    },
                  ];
                  nextCurrentId = newId;
                } else {
                  // Update-in-place: replace todos, preserve stage/blockers.
                  // Refresh label when the first todo's content changed, so
                  // a mid-list reorder doesn't leave a stale chip title. The
                  // `shouldTriggerAutoSummary` flag was pre-computed outside
                  // this handler (see snapshot block above); we just consume
                  // it here to stamp `summaryGeneratedAt` once.
                  nextLists = lists.map((l, i) => {
                    if (i !== currentIdx) return l;
                    const firstChanged =
                      !!mirrored[0] &&
                      !!l.todos[0] &&
                      mirrored[0].content !== l.todos[0].content;
                    return {
                      ...l,
                      todos: mirrored,
                      updatedAt: now,
                      label: firstChanged ? label : (l.label ?? label),
                      summaryGeneratedAt: shouldTriggerAutoSummary
                        ? now
                        : l.summaryGeneratedAt,
                    };
                  });
                }

                nextLists = capProgressLists(nextLists);

                return {
                  ...m,
                  progress: buildProgressStateFromLists({
                    lists: nextLists,
                    currentListId: nextCurrentId,
                    updatedAt: now,
                    fallbackTodos: mirrored,
                  }),
                };
              });

              // Auto-summary trigger: inject a synthetic user-role message so
              // the Agent is forced to run a new turn and decide whether to
              // call `mcp__happy__update_session_summary`. `displayText: ""`
              // hides the bubble in the App — the Agent still sees the text
              // since it drives the turn via SDK query().
              if (shouldTriggerAutoSummary) {
                try {
                  session.client.sendSyntheticUserMessage(
                    "[Auto-triggered by checklist completion]\n" +
                      "The session's active checklist just transitioned from having pending/in_progress items to fully completed. " +
                      "If the session summary needs updating to reflect what was accomplished, call mcp__happy__update_session_summary now. " +
                      "If the summary is already accurate, acknowledge briefly without calling.",
                    {
                      displayText: "",
                      sentFrom: "happy-cli-auto-summary",
                    },
                  );
                  logger.debug(
                    "[progress-mirror] auto-summary trigger dispatched",
                  );
                } catch (injectErr) {
                  logger.debug(
                    `[progress-mirror] auto-summary trigger failed: ${injectErr}`,
                  );
                }
              }
            }
          }
        }
      } catch (err) {
        logger.debug(`[progress-mirror] Error mirroring TodoWrite: ${err}`);
      }
    }

    // TaskCreate/TaskList result reconciliation: extract real task IDs from
    // TaskCreate results and reconcile full state from TaskList results.
    if (message.type === "user" && taskMirrorState.hasTasks()) {
      try {
        const uMsg = message as ClaudeJsonlUserMessage;
        const content = uMsg.message?.content;
        if (Array.isArray(content)) {
          let reconciled = false;
          for (const c of content) {
            const block = c as unknown as Record<string, unknown>;
            if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
            const resultContent = block.content;
            const text = typeof resultContent === "string"
              ? resultContent
              : Array.isArray(resultContent)
                ? (resultContent as Array<Record<string, unknown>>)
                    .filter((b) => b.type === "text" && typeof b.text === "string")
                    .map((b) => b.text as string)
                    .join("\n")
                : "";
            if (!text) continue;
            const changed = taskMirrorState.processToolResult(block.tool_use_id as string, text);
            if (changed) reconciled = true;
          }
          if (reconciled) {
            const todos = taskMirrorState.getTodos();
            session.client.updateMetadata((m) => {
              const result = applyHappyProgressUpdate(m, { todos });
              return result.metadata;
            });
          }
        }
      } catch (err) {
        logger.debug(`[task-mirror] Error processing tool_result: ${err}`);
      }
    }

    // Attribute file-editing tool calls to the current progress list so the
    // App can render per-list file change summaries. Only stores tool_use id
    // refs; diff content lives in the original message and is resolved on
    // the consumer side.
    if (message.type === "assistant") {
      try {
        const aMsg = message as ClaudeJsonlAssistantMessage;
        const blocks = Array.isArray(aMsg.message.content)
          ? aMsg.message.content
          : [];
        const fileEditIds: string[] = [];
        for (const c of blocks) {
          if (c.type !== "tool_use") continue;
          if (
            c.name !== "Edit" &&
            c.name !== "Write" &&
            c.name !== "MultiEdit" &&
            c.name !== "NotebookEdit"
          )
            continue;
          if (typeof c.id === "string" && c.id.length > 0) {
            fileEditIds.push(c.id);
          }
        }
        if (fileEditIds.length > 0) {
          session.client.updateMetadata((m) => {
            const prior = m.progress;
            const lists = prior?.lists ? [...prior.lists] : [];
            const currentId = prior?.currentListId;
            if (!currentId) return m;
            const currentIdx = lists.findIndex((l) => l.id === currentId);
            if (currentIdx < 0) return m;
            const current = lists[currentIdx]!;
            const existing = current.toolCallIds ?? [];
            const existingSet = new Set(existing);
            const toAppend = fileEditIds.filter((id) => !existingSet.has(id));
            if (toAppend.length === 0) return m;
            const now = Date.now();
            const nextLists = lists.map((l, i) =>
              i === currentIdx
                ? {
                    ...l,
                    toolCallIds: [...existing, ...toAppend],
                    updatedAt: now,
                  }
                : l,
            );
            return {
              ...m,
              progress: buildProgressStateFromLists({
                lists: nextLists,
                currentListId: prior?.currentListId,
                updatedAt: now,
                fallbackTodos: prior?.todos,
                fallbackCurrentStage: prior?.currentStage,
                fallbackBlockers: prior?.blockers,
              }),
            };
          });
        }
      } catch (err) {
        logger.debug(`[progress-mirror] Error attributing file edits: ${err}`);
      }
    }

    // Report session timeline events (fire-and-forget)
    if (reportSessionEvent) {
      reportSessionEvent(message);
    }

    // Detect plan mode tool calls
    if (message.type === "assistant") {
      let umessage = message as ClaudeJsonlAssistantMessage;
      if (umessage.message.content && Array.isArray(umessage.message.content)) {
        for (let c of umessage.message.content) {
          if (c.type === "tool_use") {
            if (c.name === "exit_plan_mode" || c.name === "ExitPlanMode") {
              logger.debug("[remote]: detected plan mode tool call " + c.id!);
              planModeToolCalls.add(c.id! as string);

              // Save plan content to file for persistence and App full-screen viewing
              const planText = (c.input as Record<string, unknown> | undefined)?.plan as string | undefined;
              if (planText && session.sessionId) {
                const plansDir = join(getProjectPath(session.path), "plans");
                const planPath = join(plansDir, `${session.sessionId}.md`);
                // Set path immediately so RPC handler can find it even before write completes
                latestPlanFilePath = planPath;
                latestPlanContent = planText;
                mkdir(plansDir, { recursive: true })
                  .then(() => writeFile(planPath, planText, "utf-8"))
                  .then(() => {
                    logger.debug(`[remote]: plan saved to ${planPath}`);
                  })
                  .catch((err) =>
                    logger.debug(`[remote]: failed to save plan file: ${err}`),
                  );
              }

              // PTY-mode plan-approval is handled by a PreToolUse allow-hook
              // (see utils/mergeExitPlanAutoApproveIntoSettings.ts +
              // scripts/exit_plan_auto_approve.cjs), injected into the
              // `--settings` file for EVERY bypass/Yolo spawn (gated on bypass
              // mode in claudeRemote, NOT on plan-mode lockdown). The hook
              // returns permissionDecision:"allow" + updatedInput, which
              // deterministically bypasses the TUI "Ready to code?" picker —
              // no keystroke synthesis, independent of render timing.
              //
              // Always-on is required for correctness: the lockdown cold
              // restart is deferred to the turn boundary, so when the model
              // runs EnterPlanMode → ExitPlanMode within one turn (the common
              // case, PID 59981) no restart fires first and a lockdown-gated
              // hook would be absent exactly when ExitPlanMode is called.
              //
              // The earlier bridge blind-wrote "1\r" to the PTY once the picker
              // was assumed ready. With no reliable picker-ready signal the
              // digit landed in the picker's free-text input and the trailing
              // CR submitted "1" as plan feedback, which Claude read as "the
              // user wants changes" and REJECTED the tool →
              // "[Request interrupted by user for tool use]" (observed in PIDs
              // 67654 / 50704). The hook removes that race entirely.
              //
              // The branch below is a SEPARATE concern: when plan-mode lockdown
              // actually engaged (a cold restart did happen and hardened the
              // deny list), tear it down so the next turn regains the full Yolo
              // toolset. DO NOT call `executionGuard.requestRestart` here: the
              // ExitPlanMode turn is still completing and a synchronous restart
              // tears it down (the very interruption we are fixing). Flip the
              // flag (so coldModeHash diverges from currentColdHash) and stash a
              // deferred restart that `onTurnComplete` consumes on the natural
              // turn boundary. A new user message before the turn ends hits the
              // divergent coldModeHash in `nextMessage` as the secondary safety
              // net.
              if (permissionHandler.isInBypassMode() && planModeLockdownActive) {
                planModeLockdownActive = false;

                // Continuation after plan approval (the part that was missing).
                //
                // In PTY mode ExitPlanMode is approved by the PreToolUse
                // allow-hook at the TUI level, so the SDK canCallTool path
                // (permissionHandler.autoApproveExitPlan) NEVER runs — and that
                // is the only place that normally queues PLAN_FAKE_RESTART to
                // continue the session. Meanwhile permissionHandler.isAborted()
                // unconditionally returns true for ExitPlanMode, so the moment
                // its tool_result arrives claudeRemote tears the PTY down with
                // SIGTERM. The outer loop relaunches with the deny list lifted
                // (planModeLockdown=false, set just above), but with no queued
                // message it blocks in nextMessage and the run idles right
                // after the plan renders — confirmed PID 47534: "Tool aborted,
                // tearing down PTY" with zero PLAN_FAKE_RESTART in the log.
                //
                // Queue the same PLAN_FAKE_RESTART continuation here, the one
                // detection point that DOES fire in PTY mode, so the relaunched
                // (lockdown-free) process resumes and implements the approved
                // plan. `unshift` (urgent) makes it the first message the
                // relaunch dispatches.
                session.queue.unshift(
                  PLAN_FAKE_RESTART,
                  { permissionMode: permissionHandler.getPermissionMode() },
                  {
                    priority: "urgent",
                    kind: "notification",
                    source: "exit-plan-continue",
                  },
                );
                logger.debug(
                  "[remote]: ExitPlanMode observed → disabling plan-mode lockdown + queued PLAN_FAKE_RESTART continuation (PTY hook approval; SDK autoApprove path skipped)",
                );
              }
            }
            // When SDK enters plan mode via EnterPlanMode tool, sync permissionHandler
            // so ExitPlanMode goes through the normal approval flow instead of auto-approving.
            // Skip if already in bypass mode — ExitPlanMode should auto-approve in YOLO/bypass.
            if (c.name === "enter_plan_mode" || c.name === "EnterPlanMode") {
              if (permissionHandler.isInBypassMode()) {
                // Yolo + plan mode is broken without `disallowedTools` for the
                // write/exec tools — see `planModeLockdownActive` declaration
                // for the full rationale. Flip the flag and trigger a cold
                // restart so the relaunched PTY honours the hardened deny
                // list. Re-entry is a no-op (already locked down).
                if (!planModeLockdownActive) {
                  planModeLockdownActive = true;
                  logger.debug(
                    "[remote]: EnterPlanMode in bypass mode → enabling plan-mode lockdown + cold restart",
                  );
                  executionGuard.requestRestart("mode_change");
                } else {
                  logger.debug(
                    "[remote]: EnterPlanMode in bypass mode (lockdown already active — no-op)",
                  );
                }
              } else {
                logger.debug(
                  "[remote]: detected EnterPlanMode — syncing permissionHandler to plan mode",
                );
                permissionHandler.handleModeChange("plan");
              }
            }
          }
        }
      }
    }

    // Track active tool calls
    if (message.type === "assistant") {
      let umessage = message as ClaudeJsonlAssistantMessage;
      if (umessage.message.content && Array.isArray(umessage.message.content)) {
        for (let c of umessage.message.content) {
          if (c.type === "tool_use") {
            logger.debug(
              "[remote]: detected tool use " +
                c.id! +
                " parent: " +
                umessage.parent_tool_use_id,
            );
            ongoingToolCalls.set(c.id!, {
              parentToolCallId: umessage.parent_tool_use_id ?? null,
            });
          }
        }
      }
    }
    // Collect tool call IDs to release atomically with the next enqueue
    let releaseIds: string[] = [];
    if (message.type === "user") {
      let umessage = message as ClaudeJsonlUserMessage;
      if (umessage.message.content && Array.isArray(umessage.message.content)) {
        for (let c of umessage.message.content) {
          if (c.type === "tool_result" && c.tool_use_id) {
            ongoingToolCalls.delete(c.tool_use_id);
            releaseIds.push(c.tool_use_id);
          }
        }
      }
    }

    // Forward status events to App (compacting, requesting, compact_boundary, etc.)
    if (message.type === "system") {
      const statusMsg = message as ClaudeJsonlStatusMsg;
      if (statusMsg.subtype === "status") {
        if (statusMsg.status === "compacting") {
          session.client.sendSessionEvent({
            type: "message",
            message: "Compacting context...",
          });
        }
        // SDK "requesting" status is no longer forwarded as a session event.
        // The App's thinking state indicator (useSessionStatus) already covers
        // the "API call in progress" signal, so the persistent "Requesting..."
        // chat chip was redundant noise.
      } else if ((message as ClaudeJsonlCompactMsg).subtype === "compact_boundary") {
        const boundaryUuid = (message as ClaudeJsonlCompactMsg).uuid;
        // sessionScanner replays the same boundary uuid back into onMessage on
        // every --resume cold-swap; emit-once gating lives in
        // compactBoundaryDedup so the downstream summary poll is skipped on
        // replays too (saves the JSONL re-read; lastEmittedCompactionSummary
        // is the second line of defence for the summary text itself).
        if (!tryRegisterCompactBoundaryEmission(emittedCompactBoundaryUuids, boundaryUuid)) {
          logger.debug(
            `[remote]: compact_boundary uuid=${boundaryUuid} already emitted — suppressing replay`,
          );
        } else {
          // Legacy text bubble — kept so older Apps that don't know the
          // `compact-boundary` structured variant still surface the event.
          // New Apps suppress this string via reducer content-window dedup
          // when the structured variant arrives within the same window.
          session.client.sendSessionEvent({
            type: "message",
            message: "Context compacted",
          });
          // Structured variant. The JSONL fields land in camelCase at
          // runtime (preTokens / postTokens / durationMs / trigger) even
          // though the TS type was declared in snake_case — read both for
          // forward-compat with whichever the TUI writes today.
          const meta = ((message as unknown) as {
            compactMetadata?: {
              trigger?: "manual" | "auto";
              preTokens?: number;
              postTokens?: number;
              durationMs?: number;
            };
            compact_metadata?: {
              trigger?: "manual" | "auto";
              pre_tokens?: number;
              post_tokens?: number;
              duration_ms?: number;
            };
          }).compactMetadata ?? ((message as unknown) as {
            compact_metadata?: {
              trigger?: "manual" | "auto";
              pre_tokens?: number;
              post_tokens?: number;
              duration_ms?: number;
            };
          }).compact_metadata;
          const preTokens =
            (meta as { preTokens?: number; pre_tokens?: number })?.preTokens ??
            (meta as { pre_tokens?: number })?.pre_tokens ??
            0;
          const postTokens =
            (meta as { postTokens?: number; post_tokens?: number })?.postTokens ??
            (meta as { post_tokens?: number })?.post_tokens ??
            0;
          const durationMs =
            (meta as { durationMs?: number; duration_ms?: number })?.durationMs ??
            (meta as { duration_ms?: number })?.duration_ms ??
            0;
          const trigger: "manual" | "auto" = meta?.trigger ?? "manual";
          // Stable envelope id mirrors the boundary uuid so two emits hash
          // to the same server-side record id; the App reducer dedups on
          // the in-payload `boundaryUuid` (envelope id isn't propagated).
          const structuredEventId = `compact-boundary-${boundaryUuid}`;
          session.client.sendSessionEvent(
            {
              type: "compact-boundary",
              boundaryUuid,
              preTokens,
              postTokens,
              durationMs,
              trigger,
            },
            structuredEventId,
          );
          // Asynchronously surface the actual compaction summary text. The
          // TUI writes the `isCompactSummary:true` user record next to
          // compact_boundary, but the file write can lag the in-memory
          // boundary by milliseconds-to-seconds — pollForCompactionSummary
          // handles the race. When it lands we re-emit the structured
          // event under the SAME id so the App's reducer treats it as an
          // update (no duplicate bubble).
          const compactedSessionId = session.sessionId;
          if (compactedSessionId) {
            const previousSummary = lastEmittedCompactionSummary;
            void pollForCompactionSummary(
              compactedSessionId,
              boundaryUuid,
              previousSummary,
            )
              .then((summary) => {
                if (!summary || summary === previousSummary) {
                  logger.debug(
                    "[remote]: no new compaction summary observed after compact_boundary",
                  );
                  return;
                }
                lastEmittedCompactionSummary = summary;
                session.client.sendSessionEvent(
                  {
                    type: "compact-boundary",
                    boundaryUuid,
                    preTokens,
                    postTokens,
                    durationMs,
                    trigger,
                    summary,
                  },
                  structuredEventId,
                );
              })
              .catch((err) => {
                logger.debug(
                  `[remote]: pollForCompactionSummary threw: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
          }
        }
        // Pre-0.100.7 we armed an auto-compact cooldown latch here to gate
        // the next auto-push of `/compact`. The auto-push is gone (hint-
        // only path) so there is nothing to gate — the user fires /compact
        // themselves, and the threshold detector's per-turn dedup latch
        // covers intra-turn re-hint suppression on its own.
        //
        // SDK-era seedReadState() pre-warmed the read cache here so the
        // post-compact assistant could Edit tracked files. PTY mode has no
        // such cache — Claude TUI re-reads files itself when needed.
      }
    }

    // Forward Task messages to session protocol
    if (
      message.type === "system" &&
      (message as ClaudeJsonlTaskStartedMessage).subtype === "task_started"
    ) {
      const m = message as ClaudeJsonlTaskStartedMessage;
      const envelope = buildProtocolMessage("agent", {
        t: "task-start",
        taskId: m.task_id,
        toolUseId: m.tool_use_id,
        description: m.description,
        taskType: m.task_type,
        workflowName: (m as any).workflow_name,
      });
      session.client.sendSessionProtocolMessage(envelope as any);
    }

    // Forward Task progress to session protocol
    if (
      message.type === "system" &&
      (message as ClaudeJsonlTaskProgressMessage).subtype === "task_progress"
    ) {
      const m = message as ClaudeJsonlTaskProgressMessage;
      const envelope = buildProtocolMessage("agent", {
        t: "task-progress",
        taskId: m.task_id,
        description: m.description,
        usage: m.usage
          ? {
              totalTokens: m.usage.total_tokens,
              toolUses: m.usage.tool_uses,
              durationMs: m.usage.duration_ms,
            }
          : undefined,
        lastToolName: m.last_tool_name,
        summary: m.summary,
      });
      session.client.sendSessionProtocolMessage(envelope as any);
    }

    // Forward memory recall to App as a session event (SDK 0.2.105+).
    // The supervisor surfaces relevant memory files into the turn; we only log
    // which memories were recalled so users can see "what I looked up".
    if (
      message.type === "system" &&
      (message as ClaudeJsonlMemoryRecallMessage).subtype === "memory_recall"
    ) {
      const m = message as ClaudeJsonlMemoryRecallMessage;
      const count = m.memories?.length ?? 0;
      if (count > 0) {
        const summary =
          m.mode === "synthesize"
            ? `Recalled ${count} memory ${count === 1 ? "note" : "notes"} (synthesized)`
            : `Recalled ${count} memory ${count === 1 ? "file" : "files"}`;
        session.client.sendSessionEvent({
          type: "message",
          message: summary,
        });
        logger.debug(
          `[remote] memory_recall (${m.mode}): ${m.memories.map((mem) => mem.path).join(", ")}`,
        );
      }
    }

    // Forward Task notification to session protocol
    if (
      message.type === "system" &&
      (message as ClaudeJsonlTaskNotificationMessage).subtype === "task_notification"
    ) {
      const m = message as ClaudeJsonlTaskNotificationMessage;
      const envelope = buildProtocolMessage("agent", {
        t: "task-end",
        taskId: m.task_id,
        status: m.status,
        summary: m.summary,
        usage: m.usage
          ? {
              totalTokens: m.usage.total_tokens,
              toolUses: m.usage.tool_uses,
              durationMs: m.usage.duration_ms,
            }
          : undefined,
      });
      session.client.sendSessionProtocolMessage(envelope as any);
    }

    // Forward Task updated (patch) to session protocol (SDK 0.3.142+)
    if (
      message.type === "system" &&
      (message as ClaudeJsonlTaskUpdatedMessage).subtype === "task_updated"
    ) {
      const m = message as ClaudeJsonlTaskUpdatedMessage;
      const envelope = buildProtocolMessage("agent", {
        t: "task-updated",
        taskId: m.task_id,
        patch: {
          status: m.patch.status,
          description: m.patch.description,
          endTime: m.patch.end_time,
          error: m.patch.error,
          isBackgrounded: m.patch.is_backgrounded,
        },
      });
      session.client.sendSessionProtocolMessage(envelope as any);
    }

    // Forward rate limit events to App (SDK 0.3.142+)
    if (message.type === "rate_limit_event") {
      const m = message as ClaudeJsonlRateLimitEvent;
      const envelope = buildProtocolMessage("agent", {
        t: "rate-limit",
        status: m.rate_limit_info.status,
        resetsAt: m.rate_limit_info.resetsAt,
        rateLimitType: m.rate_limit_info.rateLimitType,
        utilization: m.rate_limit_info.utilization,
      });
      session.client.sendSessionProtocolMessage(envelope as any);
      // Push `resetsAt` to the daemon out-of-band when the upstream
      // actually rejected us. `allowed` / `allowed_warning` are advisory
      // status pings, not real rate-limit hits — only `rejected` means the
      // next call will fail until `resetsAt` clears. The coordinator uses
      // this to defer the loop's next iteration past the window.
      if (m.rate_limit_info.status === "rejected" && m.rate_limit_info.resetsAt) {
        void notifyDaemonSessionFault(process.pid, {
          // Session.sessionId is `string | null` (null before the SDK
          // assigns one); coerce to undefined for the daemon API.
          happySessionId: session.sessionId ?? undefined,
          spawnId: process.env.HAPPY_SPAWN_ID,
          errorType: "rate_limit",
          rateLimitResetsAt: m.rate_limit_info.resetsAt,
        }).catch((err) => {
          logger.debug(`[remote] notifyDaemonSessionFault threw: ${err}`);
        });
      }
    }

    // Forward API retry status via keep-alive ephemeral channel
    if (
      message.type === "system" &&
      (message as ClaudeJsonlAPIRetryMessage).subtype === "api_retry"
    ) {
      const m = message as ClaudeJsonlAPIRetryMessage;
      session.client.keepAlive(true, "remote", true, {
        attempt: m.attempt,
        maxRetries: m.max_retries,
        retryDelayMs: m.retry_delay_ms,
        errorStatus: m.error_status ?? null,
      });
    }

    // Forward Tool progress to session protocol
    if (message.type === "tool_progress") {
      const m = message as ClaudeJsonlToolProgressMessage;
      const envelope = buildProtocolMessage("agent", {
        t: "tool-progress",
        toolUseId: m.tool_use_id,
        toolName: m.tool_name,
        elapsedSeconds: m.elapsed_time_seconds,
        taskId: m.task_id,
      });
      session.client.sendSessionProtocolMessage(envelope as any);
    }

    // Forward prompt suggestion to session protocol
    if (message.type === "prompt_suggestion") {
      const suggestion = (message as ClaudeJsonlPromptSuggestionMessage).suggestion;
      if (suggestion) {
        const envelope = buildProtocolMessage("agent", {
          t: "prompt-suggestion",
          suggestion,
        });
        session.client.sendSessionProtocolMessage(envelope as any);
      }
    }

    // Forward session state changes (idle/running/requires_action) to App
    if (
      message.type === "system" &&
      (message as ClaudeJsonlSessionStateChangedMessage).subtype === "session_state_changed"
    ) {
      const m = message as ClaudeJsonlSessionStateChangedMessage;
      const envelope = buildProtocolMessage("agent", {
        t: "session-state-changed",
        state: m.state,
      });
      session.client.sendSessionProtocolMessage(envelope as any);
    }

    // Convert SDK message to log format and send to client
    let msg = message;

    // When the user approves a plan, the SDK lacks a direct "exit plan mode" API,
    // so permissionHandler sends a fake "deny" (PLAN_FAKE_REJECT) to force Claude
    // to stop planning. Here we intercept that fake rejection in the outgoing message
    // stream and rewrite it to "Plan approved" — so the client sees the correct status
    // instead of a confusing denial message.
    if (message.type === "user") {
      let umessage = message as ClaudeJsonlUserMessage;
      if (umessage.message.content && Array.isArray(umessage.message.content)) {
        msg = {
          ...umessage,
          message: {
            ...umessage.message,
            content: umessage.message.content.map((c: any) => {
              if (
                c.type === "tool_result" &&
                c.tool_use_id &&
                planModeToolCalls.has(c.tool_use_id!)
              ) {
                if (c.content === PLAN_FAKE_REJECT) {
                  logger.debug("[remote]: hack plan mode exit");
                  logger.debugLargeJson("[remote]: hack plan mode exit", c);
                  return {
                    ...c,
                    is_error: false,
                    content: "Plan approved",
                    mode: c.mode,
                  };
                } else {
                  return c;
                }
              }
              return c;
            }),
          },
        };
      }
    }

    const logMessage = jsonlToLogConverter.convert(msg);
    if (logMessage) {
      // Add permissions field to tool result content
      if (logMessage.type === "user" && logMessage.message?.content) {
        const content = Array.isArray(logMessage.message.content)
          ? logMessage.message.content
          : [];

        // Modify the content array to add permissions to each tool_result
        for (let i = 0; i < content.length; i++) {
          const c = content[i];
          if (c.type === "tool_result" && c.tool_use_id) {
            const responses = permissionHandler.getResponses();
            const response = responses.get(c.tool_use_id);

            if (response) {
              const permissions: PermissionsField = {
                date: response.receivedAt || Date.now(),
                result: response.approved ? "approved" : "denied",
              };

              // Add optional fields if they exist
              if (response.mode) {
                permissions.mode = response.mode;
              }

              if (response.allowTools && response.allowTools.length > 0) {
                permissions.allowedTools = response.allowTools;
              }

              // Add permissions directly to the tool_result content object
              content[i] = {
                ...c,
                permissions,
              };
            }
          }
        }
      }

      // Real-time text-delta stream events are optimistic UI only; keep the
      // complete assistant text envelope as the durable history fallback. We only
      // suppress full thinking blocks after thinking deltas were streamed, because
      // thinking-only streams must never hide the final visible assistant answer.
      // IMPORTANT: reset stream flags after consuming so each assistant message
      // independently determines whether anything was streamed.
      if (logMessage.type === "assistant") {
        const contentBlocks = Array.isArray((logMessage as any).message?.content)
          ? (logMessage as any).message.content
          : [];
        const blockTypes = contentBlocks.map((b: any) => b.type);
        logger.debug(`[assistant] blocks=${JSON.stringify(blockTypes)}, textStreamed=${streamEventState.textStreamed}, visibleTextStreamed=${streamEventState.visibleTextStreamed}, thinkingStreamed=${streamEventState.thinkingStreamed}, turnId=${session.client.currentTurnId}`);
        if (streamEventState.thinkingStreamed) {
          session.client.suppressAssistantTextEnvelopes({
            text: false,
            thinking: true,
          });
        }
        // Reset per-response: the next assistant message must independently
        // prove its text was streamed before we suppress its full-text envelopes.
        streamEventState.textStreamed = false;
        streamEventState.visibleTextStreamed = false;
        streamEventState.thinkingStreamed = false;
      }

      // Queue message with optional delay for tool calls
      if (logMessage.type === "assistant" && message.type === "assistant") {
        const assistantMsg = message as ClaudeJsonlAssistantMessage;
        const toolCallIds: string[] = [];

        if (
          assistantMsg.message.content &&
          Array.isArray(assistantMsg.message.content)
        ) {
          for (const block of assistantMsg.message.content) {
            if (block.type === "tool_use" && block.id) {
              toolCallIds.push(block.id);
            }
          }
        }

        if (toolCallIds.length > 0) {
          // Check if this is a sidechain tool call (has parent_tool_use_id)
          const isSidechain = assistantMsg.parent_tool_use_id !== undefined;

          if (!isSidechain) {
            // Top-level tool call - queue with delay
            messageQueue.enqueue(logMessage, {
              delay: 250,
              toolCallIds,
              releaseToolCallIds:
                releaseIds.length > 0 ? releaseIds : undefined,
            });
            return; // Don't queue again below
          }
        }
      }

      // Queue all other messages immediately (no delay), releasing any pending tool calls atomically
      messageQueue.enqueue(
        logMessage,
        releaseIds.length > 0 ? { releaseToolCallIds: releaseIds } : undefined,
      );
    }

    // Insert a fake message to start the sidechain
    if (message.type === "assistant") {
      let umessage = message as ClaudeJsonlAssistantMessage;
      if (umessage.message.content && Array.isArray(umessage.message.content)) {
        for (let c of umessage.message.content) {
          if (
            c.type === "tool_use" &&
            (c.name === "Task" || c.name === "Agent") &&
            c.input &&
            typeof (c.input as Record<string, unknown>).prompt === "string"
          ) {
            const logMessage2 = jsonlToLogConverter.convertSidechainUserMessage(
              c.id!,
              (c.input as Record<string, unknown>).prompt as string,
            );
            if (logMessage2) {
              messageQueue.enqueue(logMessage2);
            }
          }
        }
      }
    }
  }

  // ── MCP Elicitation: forward to App, wait for response via RPC ──
  // Hoisted outside the per-turn loop so pending elicitations survive across turns
  const pendingElicitations = new Map<
    string,
    { resolve: (result: ElicitationResult) => void; reject: (err: Error) => void }
  >();
  let elicitationCounter = 0;

  session.client.rpcHandlerManager.registerHandler(
    "elicitationResponse",
    async (response: { id: string; action: string; content?: Record<string, unknown> }) => {
      const pendingItem = pendingElicitations.get(response.id);
      if (!pendingItem) {
        logger.debug(`[remote]: elicitationResponse for unknown id ${response.id}`);
        return;
      }
      const validActions = ["accept", "decline", "cancel"] as const;
      if (!validActions.includes(response.action as typeof validActions[number])) {
        logger.debug(`[remote]: invalid elicitation action: ${response.action}`);
        return;
      }
      pendingElicitations.delete(response.id);
      // Clear the elicitation banner from App
      session.client.updateAgentState((s) => ({ ...s, elicitation: null }));
      pendingItem.resolve({
        action: response.action as "accept" | "decline" | "cancel",
        content: response.content,
      } as ElicitationResult);
    },
  );

  const handleElicitation = async (
    request: ElicitationRequest,
    options: { signal: AbortSignal },
  ): Promise<ElicitationResult> => {
    const id = `elicit-${++elicitationCounter}`;
    logger.debug(`[remote]: MCP elicitation request from ${request.mcpServerName}: ${id}`);

    return new Promise<ElicitationResult>((resolve, reject) => {
      const abortHandler = () => {
        pendingElicitations.delete(id);
        // Clear the elicitation banner on abort
        session.client.updateAgentState((s) => ({ ...s, elicitation: null }));
        reject(new Error("Elicitation aborted"));
      };
      options.signal.addEventListener("abort", abortHandler, { once: true });

      pendingElicitations.set(id, {
        resolve: (result) => {
          options.signal.removeEventListener("abort", abortHandler);
          resolve(result);
        },
        reject: (err) => {
          options.signal.removeEventListener("abort", abortHandler);
          reject(err);
        },
      });

      // Push elicitation request to App via agent state
      session.client.updateAgentState((currentState) => ({
        ...currentState,
        elicitation: {
          id,
          serverName: request.mcpServerName,
          message: request.message,
          mode: request.mode ?? "form",
          url: request.url,
          requestedSchema: request.requestedSchema,
        },
      }));

      // Send push notification
      session.api
        .push()
        .sendToAllDevices(
          "MCP Input Required",
          `${request.mcpServerName}: ${request.message}`,
          {
            sessionId: session.client.sessionId,
            type: "elicitation_request",
          },
        );
    });
  };

  try {
    let pending: {
      message: string;
      mode: EnhancedMode;
      requestIds: string[];
      queueWaitMs?: number;
      socketToQueueMs?: number;
      /**
       * Origin tag carried over from the queue item that triggered the
       * cold-restart. Preserved so the post-restart `nextMessage()` return
       * can stamp `nextPromptSource` and the strand-redeliver guard keeps
       * working across the restart boundary.
       */
      source?: string;
    } | null = null;

    // Track session ID to detect when it actually changes
    // This prevents context loss when mode changes (permission mode, model, etc.)
    // without starting a new session. Only reset parent chain when session ID
    // actually changes (e.g., new session started or /clear command used).
    // See: https://github.com/anthropics/happy-cli/issues/143
    let previousSessionId: string | null = null;
    while (!exitReason) {
      logger.debug("[remote]: launch");
      messageBuffer.addMessage("═".repeat(40), "status");

      // Clear transient agentState from previous turn
      session.client.updateAgentState((s) => ({
        ...s,
        stopFailure: null,
      }));

      // Only reset parent chain and show "new session" message when session ID actually changes
      const isNewSession = session.sessionId !== previousSessionId;
      if (isNewSession) {
        messageBuffer.addMessage("Starting new Claude session...", "status");
        permissionHandler.reset(); // Reset permissions before starting new session
        jsonlToLogConverter.resetParentChain(); // Reset parent chain for new conversation
        logger.debug(
          `[remote]: New session detected (previous: ${previousSessionId}, current: ${session.sessionId})`,
        );
        // Reset knowledge injection state for the new session (/clear creates a new session)
        knowledgeInjected = false;
        worldConfigInjected = false;
        knowledgeContext = null;
        knowledgeEntries = new Map();
        pendingKnowledgeRefresh = false;
        pendingFileHint = null;
        currentTurnFilePaths = new Set<string>();
        // Reset CONTEXT.md injection and re-read for the new session
        contextMdInjected = false;
        contextMdContent = null;
        readFile(join(session.path, ".happy", "CONTEXT.md"), "utf-8").then((content) => {
          const trimmed = content.trim();
          if (trimmed) {
            contextMdContent = trimmed;
            logger.debug(`[context] Re-loaded project CONTEXT.md after session reset: ${contextMdContent.length} chars`);
          }
        }).catch(() => {});
        if (knowledgeEnabled) {
          const mode = (process.env.HAPPY_KNOWLEDGE_MODE as "auto" | "full" | "minimal") || "auto";
          session.client.fetchKnowledge(mode).then((result) => {
            if (result && (result.profile || result.entries.length > 0)) {
              knowledgeContext = formatKnowledgeForInjection(result);
              logger.debug(`[knowledge] Re-fetched context after session reset: ${knowledgeContext!.length} chars, ${result.entries.length} entries`);
            }
            syncKnowledgeConfig(result?.knowledgeConfig);
          }).catch((err) => {
            logger.debug(`[knowledge] Failed to re-fetch after session reset: ${err}`);
          });
        }
      } else {
        messageBuffer.addMessage("Continuing Claude session...", "status");
        logger.debug(
          `[remote]: Continuing existing session: ${session.sessionId}`,
        );
      }

      previousSessionId = session.sessionId;
      const controller = new AbortController();
      abortController = controller;
      abortFuture = new Future<void>();
      let modeHash: string | null = null;
      let mode: EnhancedMode | null = null;

      // "Cold hash" detects changes that require a process restart.
      // It intentionally excludes the one field that DOES take effect on the
      // live TUI:
      //   - model (within the same context-window tier): hot-swapped by
      //     claudeRemote.ts writing `/model <name>` to the PTY before the next
      //     prompt. A tier change (200K ↔ 1M) still cold-restarts via
      //     `isExtendedContext` below, since that re-binds the model flag set.
      // Cold restart is required for everything the Claude TUI binds at boot:
      //   - ANY permissionMode change: the TUI has no programmatic setter (mode
      //     cycling is Shift+Tab only, which we can't reliably target), so
      //     default ↔ acceptEdits ↔ plan ↔ bypass all restart to take effect.
      //   - allowedTools / disallowedTools: bound at spawn (settings.json/flags).
      //   - thinking, effort, maxBudgetUsd, etc.: no runtime knobs in PTY mode.
      const coldModeHash = (m: EnhancedMode) => {
        const mapped = mapToClaudeMode(m.permissionMode);
        return hashObject({
          // Full mapped permission mode — distinguishes default vs acceptEdits
          // (not just plan/bypass) so every transition forces a restart.
          permissionMode: mapped,
          // Toggling plan-mode lockdown changes the spawned process's
          // `disallowedTools` set, which Claude TUI binds at boot only —
          // hot-swap can't propagate it, so this MUST force a cold restart.
          planLockdown: planModeLockdownActive,
          // The 200K ↔ 1M tier is driven by `m.model` alone — picking a
          // 1M-capable modelMode key (e.g. `opus-4-7-1m`) IS the choice.
          // Pre-removal of the `autoCompact` protocol this also AND-gated
          // on a per-session toggle that defaulted to AUTO and would strip
          // the `[1m]` suffix; the toggle is gone (see ADR) and the model
          // key is the single source of truth.
          isExtendedContext: is1MModelKey(m.model),
          fallbackModel: m.fallbackModel,
          customSystemPrompt: m.customSystemPrompt,
          appendSystemPrompt: m.appendSystemPrompt,
          maxBudgetUsd: m.maxBudgetUsd,
          thinking: m.thinking,
          effort: m.effort,
          taskBudget: m.taskBudget,
          locale: m.locale,
          betas: m.betas,
          agent: m.agent,
          agents: m.agents,
          outputFormat: m.outputFormat,
          plugins: m.plugins,
          additionalDirectories: m.additionalDirectories,
        });
      };
      let currentColdHash: string | null = null;
      let midTurnPushFn: ((msg: ClaudeJsonlUserMessage) => void) | null = null;
      let turnDrainController: AbortController | null = null;

      // Drain mid-turn messages from the queue and push them directly to the SDK.
      // This runs concurrently during a turn, allowing user messages sent from
      // the App to be injected into the CLI subprocess stdin immediately rather
      // than waiting for the turn to complete.
      async function drainMidTurnMessages(
        signal: AbortSignal,
        currentHash: string,
        pushFn: (msg: ClaudeJsonlUserMessage) => void,
      ) {
        logger.debug("[remote]: mid-turn drain started");
        while (!signal.aborted) {
          const hasNew = await session.queue.waitForNewMessage(signal);
          if (!hasNew || signal.aborted) break;

          const take = session.queue.tryTakeForMidTurn(
            currentHash,
            coldModeHash,
          );

          if (take.status !== "taken") {
            // Head item can't be mid-turn pushed; the queue tells us why.
            if (take.status === "isolate") {
              // An isolate command (/compact, /clear) must run on a clean turn —
              // interrupt so nextMessage() can handle it properly.
              logger.debug(
                "[remote]: mid-turn drain — isolate detected, interrupting",
              );
              executionGuard.interrupt("isolated_command");
              await doInterrupt();
            } else {
              // cold-mismatch (needs a fresh process) or empty — stop draining
              // and let nextMessage() handle after the turn ends.
              executionGuard.requestRestart("mode_change");
            }
            break;
          }

          const item = take;

          // `continue` requires a fresh PTY spawn with options.continue=true.
          // It cannot be mid-turn pushed — put it back and let nextMessage()
          // handle it after the current turn finishes.
          if (item.mode.continue) {
            logger.debug(
              "[remote]: mid-turn drain — continue flag detected, deferring to nextMessage",
            );
            session.queue.push(
              item.message,
              item.mode,
              undefined,
              { priority: item.priority, kind: "continue", source: "user" },
            );
            executionGuard.requestRestart("continue");
            break;
          }

          // Handle shell commands directly without sending to Claude
          const specialCmd = parseSpecialCommand(item.message);
          if (specialCmd.type === "shell" && specialCmd.shellCommand) {
            logger.debug("[remote]: mid-turn drain — executing shell command");
            const output = await executeShellCommand(
              specialCmd.shellCommand,
              session.path,
            );
            session.client.sendDirectResult(output);
            continue;
          }

          // Mid-turn model + permission-mode changes have no PTY equivalent —
          // Claude TUI binds these flags at spawn time. coldModeHash handles
          // anything that genuinely needs a fresh process; here we only sync
          // the permission handler's local copy so prompts go to the right
          // mapped mode for the rest of this turn.
          if (mode && currentQuery) {
            const newMapped = mapToClaudeMode(item.mode.permissionMode);
            const currentMapped = mapToClaudeMode(mode.permissionMode);
            if (
              newMapped !== currentMapped &&
              newMapped !== "plan" && currentMapped !== "plan" &&
              newMapped !== "bypassPermissions" && currentMapped !== "bypassPermissions"
            ) {
              logger.debug(
                `[remote]: mid-turn permission-mode change observed: ${currentMapped} → ${newMapped} (no PTY hot-swap; updating handler only)`,
              );
              permissionHandler.handleModeChange(item.mode.permissionMode);
            }
          }

          // Update tracked mode state
          modeHash = item.modeHash;
          mode = item.mode;

          // Push the message to the SDK for mid-turn injection.
          // Strand probe: if the turn is dead (guard running, high idle, no
          // active tools), this push types into a wedged PTY and won't run —
          // the state captured here proves it from the log.
          logger.debug(
            `[remote]: mid-turn push — ${item.message.length} chars. ${strandDiagState()}`,
          );
          pushFn({
            type: "user",
            message: { role: "user", content: item.message },
            parent_tool_use_id: null,
            session_id: undefined,
          });
        }
        logger.debug("[remote]: mid-turn drain stopped");
      }

      function startMidTurnDrain() {
        if (!midTurnPushFn || !currentColdHash) return;
        // Stop any previous drain
        turnDrainController?.abort();
        turnDrainController = new AbortController();
        drainMidTurnMessages(
          turnDrainController.signal,
          currentColdHash,
          midTurnPushFn,
        );
      }

      function stopMidTurnDrain() {
        turnDrainController?.abort();
        turnDrainController = null;
      }

      // PTY migration: in-process SDK MCP servers were replaced by an HTTP MCP
      // server hosted on the CLI side (see startHappyServer). Claude TUI is
      // wired to this server via `--mcp-config` (see claudePtyRuntime), which
      // exposes the `happy` namespace with all four tools (change_title,
      // update_progress, update_session_summary, query_project_knowledge).
      // We retain the in-process closures only to handle one extra side effect
      // (`syncKnowledgeConfig` after each knowledge query) — but that fires
      // inside the HTTP handler via its own client reference, so nothing here
      // needs to be wired into Claude. Subscribe knowledge tracking through
      // session.client.fetchKnowledge directly.
      const happyHttp = await startHappyServer(session.client);
      const happyHttpUrl = `${happyHttp.url.replace(/\/$/, "")}/mcp`;
      logger.debug(`[happyMCP] HTTP url=${happyHttpUrl}`);

      // Stop the HTTP server when the session closes.
      const stopHappyHttp = happyHttp.stop;
      void stopHappyHttp; // ensure the var is retained; cleanup happens in finally

      // Build via the shared helper so the `alwaysLoad: true` flag (Claude
      // Code 2.1.121+) stays attached to every happy server — that keeps the
      // App's permission/sync tools loaded across `/clear`, plan-mode swaps,
      // and skill-driven tool-search deferrals.
      const happyServers = buildHappyMcpServers(happyHttpUrl, {
        includeKnowledge: knowledgeEnabled,
      });
      const happyMcpServer: HappyMcpServerEntry = happyServers.happy;
      const knowledgeMcpServer: HappyMcpServerEntry | null =
        happyServers["happy-knowledge"] ?? null;

      // Fetch persistent MCP registry from server KV (non-blocking — falls back to {} on error)
      const registryServers = await fetchMcpRegistryServers(session.api);

      // Seed MCP server state: protected servers (cannot be removed/overwritten by App),
      // and user servers from local settings + registry for diffing.
      mcpServerState.protectedServers = {
        happy: happyMcpServer as unknown as Record<string, unknown>,
        ...(knowledgeMcpServer ? { "happy-knowledge": knowledgeMcpServer as unknown as Record<string, unknown> } : {}),
      };
      // Tag any MCP the user disabled (via `/mcp disable` in Claude Code,
      // persisted to `~/.claude.json` → projects[cwd].disabledMcpServers) so
      // the App's MCP panel can render them as `status: 'disabled'`. The
      // `--mcp-config` serialiser drops these entries before they reach
      // Claude CLI; Claude itself still respects its own native list.
      //
      // Plugin-marketplace MCPs (keyed `plugin:<plugin>:<server>`) are folded
      // in here too — `disabledMcpServers` stores them under the same
      // prefixed name, so a single `markDisabledMcpServers` pass handles both.
      const disabledMcpNames = readClaudeDisabledMcpServers(session.path);
      const userMcpServers = markDisabledMcpServers(
        {
          ...readClaudeMcpServers(),
          ...readClaudePluginMcpServers(),
        },
        disabledMcpNames,
      );

      mcpServerState.userServers = {
        ...userMcpServers as Record<string, Record<string, unknown>>,
        ...registryServers,
      };

      // Refill the shared liveMcpServers map in place. Clearing first guards
      // against stale entries from a prior turn (e.g. a server the user
      // removed). The RPC toggle handler mutates this same reference, so
      // the PTY controller reads new states without a session restart.
      for (const key of Object.keys(liveMcpServers)) delete liveMcpServers[key];
      Object.assign(liveMcpServers, {
        ...userMcpServers,               // User's Claude Code MCPs from ~/.claude.json (+settings.json fallback) — lowest priority
        ...registryServers,              // Account-level MCP registry (medium priority)
        happy: happyMcpServer,           // Happy-owned MCPs (highest priority)
        ...(knowledgeMcpServer ? { "happy-knowledge": knowledgeMcpServer } : {}),
      });

      try {
        await claudeRemote({
          sessionId: session.sessionId,
          path: session.path,
          allowedTools: session.allowedTools ?? [],
          // Persisted across cold restarts; flipped by the EnterPlanMode /
          // ExitPlanMode blocks above. When true, claudeRemote will inject
          // Write/Edit/MultiEdit/NotebookEdit/Bash into disallowedTools so the
          // Yolo+plan-mode hang documented at `planModeLockdownActive` can't
          // recur.
          planModeLockdown: planModeLockdownActive,
          // Same reference the RPC handler mutates; the PTY controller's
          // mcpServerStatus() reads it live on each poll, so toggles take
          // effect without restarting the session.
          mcpServers: liveMcpServers,
          hookSettingsPath: session.hookSettingsPath,
          jsRuntime: session.jsRuntime,
          happySessionId: session.client.sessionId,
          canCallTool: permissionHandler.handleToolCall,
          onElicitation: handleElicitation,
          isAborted: (toolCallId: string) => {
            return permissionHandler.isAborted(toolCallId);
          },
          onTurnComplete: () => {
            finishTurn();
          },
          nextMessage: async () => {
            // Stop any running mid-turn drain from the previous turn
            stopMidTurnDrain();

            if (pending) {
              let p = pending;
              pending = null;
              // The new PTY is about to consume a cold-restart continuation
              // (PLAN_FAKE_RESTART, isolate slash command, or mode-change
              // cold-swap). Open a grace window so the sessionScanner replay
              // burst the new --resume produces doesn't mark this turn as
              // "produced output" — that would mask a real submission wedge
              // from both the 90s fast-wedge path and the re-deliver guard.
              // See coldRestartGraceUntil declaration for full rationale.
              coldRestartGraceUntil = Date.now() + COLD_RESTART_GRACE_MS;
              dispatchTurn(reasonForQueuedMessage(p));
              // Re-establish tracked mode state for the post-cold-restart turn.
              // The restart loop reset these to null, so without this the
              // onPromptWritten capture would record mode=null and
              // startMidTurnDrain() (called just below) would no-op on a null
              // currentColdHash — leaving no drain alive to consume a strand
              // re-delivery. The new PTY was spawned with p.mode's cold params,
              // so coldModeHash(p.mode) is exactly right here. modeHash stays
              // null (pending carries no full hash); the next turn re-derives it
              // via the normal path, as it always has.
              mode = p.mode;
              currentColdHash = coldModeHash(p.mode);
              // Reset E2E perf tracking for new turn
              _perfTurnSocketReceivedAt = p.mode._perfSocketReceivedAt;
              _perfTurnFirstResponseLogged = false;

              streamEventState = createStreamEventMapperState();
              permissionHandler.handleModeChange(p.mode.permissionMode);
              startMidTurnDrain();
              nextPromptSource = p.source;
              return p;
            }

            const dequeueStartAt = Date.now();
            let msg = await session.queue.waitForMessagesAndGetAsString(
              controller.signal,
            );
            const dequeuedAt = Date.now();
            if (msg) {
              logger.debug(`[perf] nextMessage: dequeue took ${dequeuedAt - dequeueStartAt}ms, msg=${msg.message.substring(0, 80)}`);
            }

            if (msg) {
              // Check if mode has changed
              if (msg.isolate) {
                logger.debug("[remote]: isolate requested, pending message");
                executionGuard.requestRestart("isolated_command");
                pending = msg;
                return null;
              }

              // continue requires a fresh PTY spawn with options.continue=true
              if (msg.mode.continue) {
                logger.debug(
                  "[remote]: continue flag detected, forcing restart for new query",
                );
                executionGuard.requestRestart("continue");
                pending = msg;
                return null;
              }

              if (modeHash && msg.hash !== modeHash) {
                // Mode changed. Check if cold-restart fields are unchanged (hot-swappable).
                const newColdHash = coldModeHash(msg.mode);
                if (currentColdHash && newColdHash === currentColdHash) {
                  // Only hot-swappable fields changed. The model swap (the one
                  // field excluded from coldModeHash) is applied by
                  // claudeRemote.ts writing `/model <name>` to the PTY just
                  // before this message's prompt — no process restart needed.
                  // permissionMode is NOT listed: any permissionMode change now
                  // diverges coldModeHash and takes the cold-restart path below.
                  const changed = [
                    mode?.model !== msg.mode.model && "model",
                    JSON.stringify(mode?.allowedTools) !== JSON.stringify(msg.mode.allowedTools) &&
                      "allowedTools",
                    JSON.stringify(mode?.disallowedTools) !== JSON.stringify(msg.mode.disallowedTools) &&
                      "disallowedTools",
                  ]
                    .filter(Boolean)
                    .join(", ");
                  logger.debug(
                    `[remote]: hot-swap detected (${changed || "unknown"}), no restart needed`,
                  );
                  dispatchTurn(reasonForQueuedMessage(msg));
                  modeHash = msg.hash;
                  mode = msg.mode;
                  // Reset E2E perf tracking for hot-swap turn
                  _perfTurnSocketReceivedAt = msg.mode._perfSocketReceivedAt;
                  _perfTurnFirstResponseLogged = false;
    
                  streamEventState = createStreamEventMapperState();
                  permissionHandler.handleModeChange(mode.permissionMode);
                  startMidTurnDrain();
                  nextPromptSource = msg.source;
                  return {
                    message: msg.message,
                    mode: msg.mode,
                  };
                }

                // Other fields changed — cold restart required
                logger.debug(
                  "[remote]: non-model mode change detected, pending message for restart",
                );

                // When switching TO bypass/yolo, immediately sync the permission
                // handler so any in-flight tool calls are auto-approved and stale
                // "needs permission" indicators are cleared before the cold restart.
                const newMappedForRestart = mapToClaudeMode(msg.mode.permissionMode);
                if (newMappedForRestart === "bypassPermissions") {
                  permissionHandler.handleModeChange(msg.mode.permissionMode);
                  permissionHandler.autoApproveAllPending();
                }

                executionGuard.requestRestart("mode_change");
                pending = msg;
                return null;
              }

              dispatchTurn(reasonForQueuedMessage(msg));
              modeHash = msg.hash;
              mode = msg.mode;
              currentColdHash = coldModeHash(mode);
              // Reset E2E perf tracking for new turn
              _perfTurnSocketReceivedAt = msg.mode._perfSocketReceivedAt;
              _perfTurnFirstResponseLogged = false;

              streamEventState = createStreamEventMapperState();
              permissionHandler.handleModeChange(mode.permissionMode);
              startMidTurnDrain();

              // App prompt (appendSystemPrompt) injection is handled by
              // claudeRemote.ts buildSystemReminderPrefix(). Do NOT inject here
              // — it causes the same content to appear twice in each message.

              // Knowledge injection: prepend to message (appendSystemPrompt path is broken)
              let effectiveKnowledgeContext = knowledgeContext;

              if (!knowledgeInjected && knowledgeEnabled) {
                // If pre-fetch hasn't completed yet, do a contextual fetch with hints (max 1500ms)
                if (!effectiveKnowledgeContext) {
                  const hints = extractKnowledgeHints(msg.message, 8);
                  if (hints.length > 0) {
                    try {
                      const fetchMode = (process.env.HAPPY_KNOWLEDGE_MODE as "auto" | "full" | "minimal") || "auto";
                      const contextualResult = await Promise.race([
                        session.client.fetchKnowledge(fetchMode, hints),
                        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
                      ]);
                      if (contextualResult && (contextualResult.profile || contextualResult.entries.length > 0)) {
                        effectiveKnowledgeContext = formatKnowledgeForInjection(contextualResult);
                        knowledgeContext = effectiveKnowledgeContext;
                        logger.debug(`[knowledge] Contextual fetch on first message: ${effectiveKnowledgeContext.length} chars, ${contextualResult.entries.length} entries`);
                      }
                      syncKnowledgeConfig(contextualResult?.knowledgeConfig);
                    } catch (err) {
                      logger.debug(`[knowledge] Contextual fetch failed: ${err}`);
                    }
                  }
                }
              } else if (knowledgeInjected && pendingKnowledgeRefresh && knowledgeEnabled) {
                // Per-turn refresh: check if new knowledge entries exist since last injection.
                // Prepend a lightweight notification to the user message so Claude can use
                // the query_project_knowledge MCP tool to fetch relevant details on demand.
                pendingKnowledgeRefresh = false;
                const hints = extractKnowledgeHints(msg.message, 8);
                logger.debug(`[knowledge] Per-turn refresh check: ${hints.length} hints from message`);
                try {
                  const refreshResult = await Promise.race([
                    session.client.fetchKnowledge("auto", hints.length > 0 ? hints : undefined),
                    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
                  ]);
                  syncKnowledgeConfig(refreshResult?.knowledgeConfig);
                  if (refreshResult && refreshResult.entries.length > 0) {
                    const newEntries = refreshResult.entries.filter((e) => !knowledgeEntries.has(e.id));
                    logger.debug(`[knowledge] Per-turn refresh: ${refreshResult.entries.length} total, ${newEntries.length} new`);
                    if (newEntries.length > 0) {
                      for (const e of newEntries) {
                        knowledgeEntries.set(e.id, { id: e.id, title: e.title, tags: e.tags });
                      }
                      // Prepend a lightweight hint — Claude uses query_project_knowledge to get details
                      const titles = newEntries.map((e) => `"${e.title}"`).join(", ");
                      const hint = `[Knowledge base update: ${newEntries.length} new ${newEntries.length === 1 ? "entry" : "entries"} added (${titles}). Use query_project_knowledge tool if relevant to this task.]\n\n`;
                      nextPromptSource = msg.source;
                      return {
                        message: hint + msg.message,
                        mode: msg.mode,
                      };
                    }
                  } else {
                    logger.debug(`[knowledge] Per-turn refresh: timeout or no entries`);
                  }
                } catch (err) {
                  logger.debug(`[knowledge] Per-turn refresh failed: ${err}`);
                }
              }

              // File-aware hint: prepend if available and no higher-priority injection is pending
              if (knowledgeInjected && pendingFileHint) {
                const hint = pendingFileHint;
                pendingFileHint = null;
                nextPromptSource = msg.source;
                return {
                  message: hint + msg.message,
                  mode: msg.mode,
                };
              }

              // First-time knowledge injection: prepend to message instead of mode.appendSystemPrompt
              // (appendSystemPrompt via IPC is broken in SDK 0.2.119+ native binary)
              const knowledgePrefix = !knowledgeInjected && effectiveKnowledgeContext
                ? effectiveKnowledgeContext + "\n\n"
                : "";
              if (!knowledgeInjected && effectiveKnowledgeContext) {
                knowledgeInjected = true;
                logger.debug("[knowledge] Injected knowledge into first message");
              }

              // World config injection: inject narrative/laws once per session
              const worldConfigPrefix = !worldConfigInjected && worldConfig
                ? buildWorldConfigPrefix(worldConfig)
                : "";
              if (!worldConfigInjected && worldConfig && worldConfigPrefix) {
                worldConfigInjected = true;
                logger.debug("[world-config] Injected world narrative/laws into first message");
              }

              // Project CONTEXT.md: inject once per session before all other prefixes
              const contextMdPrefix = !contextMdInjected && contextMdContent
                ? `<project-context>\n${contextMdContent}\n</project-context>\n\n`
                : "";
              if (!contextMdInjected && contextMdContent) {
                contextMdInjected = true;
                logger.debug("[context] Injected project CONTEXT.md into first message");
              }

              nextPromptSource = msg.source;
              return {
                message: contextMdPrefix + worldConfigPrefix + knowledgePrefix + msg.message,
                mode: msg.mode,
              };
            }

            // Exit
            return null;
          },
          onSessionFound: (sessionId) => {
            // Update converter's session ID when new session is found
            jsonlToLogConverter.updateSessionId(sessionId);
            session.onSessionFound(sessionId);
          },
          // Wire the hookServer-driven session-id channel into claudeRemote so
          // its internal scanner learns which JSONL file to watch as soon as
          // Claude's SessionStart hook fires. Without this, fresh PTY-mode
          // sessions silently sit watching nothing while the TUI happily
          // writes user/assistant records into a file no one is reading.
          registerSessionFoundCallback: (cb) => {
            session.addSessionFoundCallback(cb);
            return () => session.removeSessionFoundCallback(cb);
          },
          // PTY-mode bridge for the App's `sdkSessionState` path.
          //
          // The App's `isSessionRunning(session)` (sources/utils/sessionUtils.ts)
          // short-circuits on `session.sdkSessionState != null` — only when
          // sdkSessionState is null does it fall back to the legacy
          // `session.thinking` flag we keep up to date via keepAlive heartbeats.
          //
          // The only producer of sdkSessionState updates is a
          // `session-state-changed` envelope. SDK-era happy-cli relayed those
          // from Claude SDK's `system.subtype=session_state_changed` JSONL
          // records (see the forwarder at the top of `onMessage` below).
          // Claude TUI in PTY mode does NOT emit those records, so under the
          // current PTY launcher this envelope is never produced — App-side
          // sdkSessionState stays at whatever last live/historical value it
          // had (often "running" from an earlier SDK turn, or carried over
          // from a different session). That makes the App think the session
          // is forever "thinking" (e.g. the puttering... indicator never
          // clears) regardless of the truthful keepAlive heartbeats.
          //
          // Fix: synthesize the envelope on every thinking transition so the
          // modern path observes the same truth as the heartbeat path. PTY
          // mode has no `requires_action` (no canCallTool synchronous pause
          // — see permissionHandler doc), so we only emit running↔idle.
          // updateThinking() inside claudeRemote.ts already dedupes
          // (`if (thinking === next) return`), so this fires at most twice
          // per turn (start + end), not on every tick.
          onThinkingChange: (thinking: boolean) => {
            session.onThinkingChange(thinking);
            const stateEnvelope = buildProtocolMessage("agent", {
              t: "session-state-changed",
              state: thinking ? "running" : "idle",
            });
            session.client.sendSessionProtocolMessage(stateEnvelope as any);
          },
          claudeEnvVars: session.claudeEnvVars,
          claudeArgs: session.claudeArgs,
          onMessage,
          // Raw PTY byte activity is the watchdog's primary liveness signal:
          // the animated spinner emits bytes the whole time Claude is working
          // (thinking/streaming/tool-running), whereas a strand falls silent.
          // JSONL messages (onMessage) alone miss the pure-thinking and
          // MCP-tool phases, which is why slow first tokens were misread as
          // strands and aborted. See the watchdog block for the full rationale.
          onPtyActivity: () => {
            lastClaudeOutputAt = Date.now();
          },
          // Mirror TUI terminal control signals (window-title updates, iTerm2
          // OSC 9 notifications, BEL) to remote App / Web clients via a
          // `terminal-signal` wire event. Claude Code 2.1.139+ hooks can use
          // `terminalSequence` to surface progress/notifications even when the
          // user has no terminal attached; in PTY mode we observe those bytes
          // and re-emit them in structured form so the App can render them as
          // a banner / push notification without having to parse ANSI itself.
          onTerminalSignal: (event) => {
            // Map the parser kinds to the wire's discriminated enum,
            // collapsing optional payload fields. App-side rendering is
            // permissive (sessionEventSchemaPermissive) so unknown kinds added
            // here in future versions just fall through; we still tag the OSC
            // code on `other` events for downstream routing.
            const payload =
              event.kind === "windowTitle"
                ? { t: "terminal-signal", kind: "window-title", text: event.title }
                : event.kind === "notification"
                ? { t: "terminal-signal", kind: "notification", text: event.body }
                : event.kind === "progress"
                ? {
                    t: "terminal-signal",
                    kind: "progress",
                    progressState: event.state,
                    progressValue: event.value,
                  }
                : event.kind === "bell"
                ? { t: "terminal-signal", kind: "bell" }
                : {
                    t: "terminal-signal",
                    kind: "other",
                    text: event.payload,
                    oscCode: event.ps,
                  };
            const envelope = buildProtocolMessage("agent", payload);
            session.client.sendSessionProtocolMessage(envelope as any);
          },
          // Mirror the TUI's *rendered* status surface — the spinner status
          // line ("Reasoning… · 1.2k tokens") and numbered pickers — as
          // `terminal-signal` events of kind `activity` / `picker`. The
          // parser debounces internally (≥1 s between counter-only updates),
          // so this stays far below the heartbeat cadence.
          onTuiStatus: (event) => {
            const payload =
              event.kind === "activity"
                ? {
                    t: "terminal-signal",
                    kind: "activity",
                    text: event.verb,
                    tokens: event.tokens,
                    seconds: event.seconds,
                  }
                : {
                    t: "terminal-signal",
                    kind: "picker",
                    text: event.snippet,
                  };
            const envelope = buildProtocolMessage("agent", payload);
            session.client.sendSessionProtocolMessage(envelope as any);
          },
          // Capture the EXACT text written to the composer (bracketed-paste
          // payload, including any once-per-session prefixes the launcher
          // prepended) as the in-flight prompt. If a tier-1 Esc recovery has
          // to clear the composer before this turn ever ran, the watchdog
          // re-delivers this verbatim — preserving CONTEXT.md/world-config/
          // knowledge that raw msg.message would lose (their *Injected flags
          // suppress re-injection). `mode` is the launcher's current turn mode,
          // which matches currentColdHash at strand time so the re-pushed
          // message is accepted by the still-alive mid-turn drain.
          onPromptWritten: (text: string) => {
            // `nextPromptSource` was stamped at every nextMessage() return
            // site below. Pair it with the captured write so `maybeRedeliver
            // StrandedPrompt` can decide whether to re-push (real user
            // prompt → yes; auto-compact internal isolate → no).
            inFlightPrompt = {
              message: text,
              mode: mode!,
              source: nextPromptSource,
            };
            // Consume so a stale value cannot leak into the next turn if
            // the next nextMessage() return forgets to re-stamp.
            nextPromptSource = undefined;
            // Reset the echo-confirmation latch so the WRITE_VERIFY check
            // below re-validates THIS prompt's submission. Without this,
            // a strand-redeliver mid-turn push would inherit the previous
            // prompt's confirmed=true status, letting a second wedge slip
            // past the 45s elapsed-based strand check until the 90s
            // WEDGE_RECOVER / 120s IDLE_RECOVER path picks it up.
            promptSubmissionConfirmed = false;
            // Post-write submission-wedge check. A healthy submit makes the TUI
            // echo the pasted prompt within milliseconds (raw PTY bytes →
            // onPtyActivity → lastClaudeOutputAt advances past writtenAt); a
            // wedge — the paste dropped/folded so the prompt never submits —
            // produces zero echo and zero JSONL. If NEITHER has appeared shortly
            // after the write, run the proven Esc+re-deliver recovery now rather
            // than waiting the ~40s watchdog tick. writtenAt is captured before
            // any echo (onPromptWritten fires synchronously after the write), so
            // a working turn's echo/spinner reliably clears the check; only a
            // genuine wedge trips it — and re-delivery is double-execution safe
            // because zero output means nothing ran.
            const writtenAt = Date.now();
            clearWriteVerify();
            writeVerifyTimer = setTimeout(() => {
              writeVerifyTimer = null;
              if (exitReason || strandRecoveryInFlight) return;
              if (executionGuard.getSnapshot().state !== "running") return;
              // Echo / output observed after the write → TUI consumed the
              // paste, the prompt is genuinely in flight. Arm the echo-
              // confirmation latch so the 45s elapsed-based strand check
              // below stops misreading legitimate slow first tokens (Opus
              // xhigh thinking) as a submission wedge. Real wedges produce
              // zero echo and fall through to the recovery branch below
              // (still ~2.5s, far faster than the 45s path).
              if (turnProducedOutput || lastClaudeOutputAt > writtenAt) {
                promptSubmissionConfirmed = true;
                return;
              }
              if (ongoingToolCalls.size > 0 || pendingElicitations.size > 0) return;
              logger.debug(
                `[remote][strand] post-write wedge — no PTY echo/output ${Date.now() - writtenAt}ms after prompt write, fast auto-recovery. ${strandDiagState()}`,
              );
              void recoverStrandedTurn(Date.now() - lastClaudeOutputAt);
            }, WRITE_VERIFY_MS);
            if (typeof writeVerifyTimer.unref === "function") {
              writeVerifyTimer.unref();
            }
          },
          onCompletionEvent: (message: string) => {
            logger.debug(`[remote]: Completion event: ${message}`);
            session.client.sendSessionEvent({ type: "message", message });
          },
          // `onCompactNoOp` handler was removed in 0.100.7. It used to arm
          // an auto-compact cooldown latch when the TUI compact silently
          // no-op'd, gating the next auto-push of `/compact`. With auto-push
          // gone (hint-only path) there is nothing to gate — the user
          // decides when to retry /compact themselves.
          onShellResult: (output: string) => {
            logger.debug("[remote]: Shell command result received");
            session.client.sendDirectResult(output);
          },
          onQueryReady: (query) => {
            currentQuery = query;
            // Knowledge base: mark new turn start
            if (turnCollector) {
              const turnId = `turn-${Date.now()}`;
              const model = session.model ?? "unknown";
              turnCollector.startTurn(turnId, model);
            }
          },
          onMessagesReady: (pushFn) => {
            midTurnPushFn = pushFn;
            // The first nextMessage() call happens BEFORE onMessagesReady fires
            // (claudeRemote.ts fetches the initial message before exposing
            // the push function). That means the startMidTurnDrain() call
            // inside nextMessage() silently returns (midTurnPushFn is still
            // null at that point). We must start it here once the push
            // function becomes available, otherwise user messages sent
            // during the first turn are queued but never forwarded to the
            // SDK until the turn finishes.
            startMidTurnDrain();
          },
          onInitialized: (info) => {
            logger.debug(
              `[remote]: claude initialized — ${info.models?.length ?? 0} models`,
            );
            if (info.models && info.models.length > 0) {
              session.client.updateMetadata((m) => ({
                ...m,
                models: info.models,
              }));
            }
          },
          onSessionReset: () => {
            logger.debug("[remote]: Session reset");
            session.clearSessionId();
          },
          onResult: (data) => {
            lastResultData = data;
          },
          onContextUsage: (ctx) => {
            const envelope = buildProtocolMessage("agent", {
              t: "context-usage" as const,
              totalTokens: ctx.totalTokens,
              maxTokens: ctx.maxTokens,
              percentage: ctx.percentage,
              model: ctx.model,
              categories: ctx.categories?.map((c) => ({
                name: c.name,
                tokens: c.tokens,
                ...(c.color ? { color: c.color } : {}),
              })),
              messageBreakdown: ctx.messageBreakdown,
            });
            session.client.sendSessionProtocolMessage(envelope as any);
          },
          onMaxTurnsReached: () => {
            logger.debug(
              "[remote]: Max turns reached — sending needs-continue",
            );
            const envelope = buildProtocolMessage("agent", {
              t: "needs-continue",
            });
            session.client.sendSessionProtocolMessage(envelope as any);
          },
          onReady: async () => {
            // Stop mid-turn drain before flushing — prevents race with nextMessage()
            stopMidTurnDrain();

            // Knowledge base: process turn end and check if extraction needed
            // Wrapped in try-catch to never block session flow
            try {
              if (turnCollector) {
                const outputTokens = lastResultData?.modelUsage
                  ? Object.values(lastResultData.modelUsage).reduce((sum, m) => sum + m.outputTokens, 0)
                  : 0;
                const readyTurns = turnCollector.onTurnEnd(outputTokens);
                if (readyTurns) {
                  pendingKnowledgeRefresh = true;
                  logger.debug(`[knowledge] Submitting ${readyTurns.length} turns`);
                  for (const turn of readyTurns) {
                    session.client.submitKnowledge({
                      entryType: inferEntryType(turn.userMessage, turn.assistantText),
                      contributorType: "session",
                      action: "create",
                      title: turn.userMessage.split("\n")[0].slice(0, 200) || "Session activity",
                      content: turn.assistantText.slice(0, 4000),
                      request: turn.userMessage.slice(0, 500),
                      outcome: turn.fileEdits.length > 0
                        ? `Modified ${turn.fileEdits.length} file(s): ${turn.fileEdits.map((f) => f.path).join(", ").slice(0, 500)}`
                        : undefined,
                      tags: extractTags(turn.fileEdits),
                      confidence: turn.outputTokens > 1000 ? "high" : "medium",
                      model: turn.model,
                      affectedFiles: turn.fileEdits.map((f) => f.path),
                    });
                  }
                }
              }
            } catch (err) {
              logger.debug(`[knowledge] Error in onReady turn processing: ${err}`);
            }

            // Per-turn hit detection: which injected knowledge entries were referenced
            // by the assistant in this turn? Substring match on full title, title words,
            // and tags catches real usage without an extra LLM pass. Server uses this
            // to tick TTL counters. Emit even when hitIds is empty so the server can
            // decrement misses on every turn.
            try {
              if (turnCollector && knowledgeEntries.size > 0) {
                const assistantText = turnCollector.getAssistantTextSnapshot().toLowerCase();
                const hitIds: string[] = [];
                if (assistantText.length > 0) {
                  for (const entry of knowledgeEntries.values()) {
                    let matched = false;
                    const lowerTitle = entry.title.toLowerCase();
                    if (lowerTitle.length >= 6 && assistantText.includes(lowerTitle)) {
                      matched = true;
                    }
                    // Match any significant title word (>=4 chars, alphanumeric) so partial
                    // paraphrases still register as a hit without reaching a full-title match.
                    if (!matched) {
                      const titleWords = lowerTitle
                        .split(/[^\p{L}\p{N}]+/u)
                        .filter((w) => w.length >= 4);
                      for (const word of titleWords) {
                        if (assistantText.includes(word)) {
                          matched = true;
                          break;
                        }
                      }
                    }
                    if (!matched) {
                      for (const tag of entry.tags) {
                        const lowerTag = tag.toLowerCase();
                        if (lowerTag.length >= 2 && assistantText.includes(lowerTag)) {
                          matched = true;
                          break;
                        }
                      }
                    }
                    if (matched) hitIds.push(entry.id);
                  }
                }
                session.client.emitKnowledgeTurnEnd(hitIds);
                logger.debug(
                  `[knowledge] Turn-end hits: ${hitIds.length}/${knowledgeEntries.size} (injected entries)`,
                );
              }
            } catch (err) {
              logger.debug(`[knowledge] Error detecting turn hits: ${err}`);
            }

            // File-aware knowledge hint: check edited files against knowledge base
            // Fire-and-forget — result stored for next message prefix
            if (knowledgeEnabled && currentTurnFilePaths.size > 0) {
              const editedPaths = [...currentTurnFilePaths];
              currentTurnFilePaths = new Set<string>();
              const fileHints = extractTags(editedPaths.map((p) => ({ path: p, type: "edit" as const })));
              if (fileHints.length > 0) {
                session.client.fetchKnowledge("auto", fileHints).then((result) => {
                  syncKnowledgeConfig(result?.knowledgeConfig);
                  if (!result || result.entries.length === 0) return;
                  const newEntries = result.entries.filter((e) => !knowledgeEntries.has(e.id));
                  if (newEntries.length === 0) return;
                  for (const e of newEntries) {
                    knowledgeEntries.set(e.id, { id: e.id, title: e.title, tags: e.tags });
                  }
                  const fileNames = editedPaths.map((p) => p.split("/").pop()).filter(Boolean).join(", ");
                  const titles = newEntries.slice(0, 3).map((e) => `"${e.title}"`).join(", ");
                  pendingFileHint = `[File knowledge hint: you edited ${fileNames} — ${newEntries.length} related knowledge ${newEntries.length === 1 ? "entry" : "entries"} found (${titles}). Use query_project_knowledge if relevant.]\n\n`;
                  logger.debug(`[knowledge] File-aware hint queued for ${newEntries.length} entries`);
                }).catch((err) => {
                  logger.debug(`[knowledge] File-aware hint fetch failed: ${err}`);
                });
              }
            } else {
              currentTurnFilePaths = new Set<string>();
            }

            // Flush queued messages before closing the turn to prevent
            // turn-end from arriving at the App before delayed tool call messages
            await messageQueue.flush();
            session.client.closeClaudeSessionTurn(
              "completed",
              lastResultData ?? undefined,
            );
            lastResultData = null;
            if (!pending && session.queue.size() === 0) {
              session.api
                .push()
                .sendToAllDevices(
                  "It's ready!",
                  `Claude is waiting for your command`,
                  { sessionId: session.client.sessionId },
                );
            }
          },
          signal: abortController.signal,
        });

        // Consume one-time Claude flags after spawn
        session.consumeOneTimeFlags();

        if (!exitReason && abortController.signal.aborted) {
          session.client.closeClaudeSessionTurn("cancelled", lastResultData ?? undefined);
          lastResultData = null;
          // The watchdog's tier-2 cold restart aborts the same controller a user
          // stop does — distinguish them so an auto-recovery isn't mislabeled as
          // a user action (the user never pressed anything; the turn was stuck).
          session.client.sendSessionEvent({
            type: "message",
            message: strandColdRestart
              ? "Session process restarted — ready for your next message"
              : "Aborted by user",
          });
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.debug("[remote]: launch error", err.message, err.stack, e);
        if (!exitReason) {
          session.client.closeClaudeSessionTurn("failed", lastResultData ?? undefined);
          lastResultData = null;
          session.client.sendSessionEvent({
            type: "message",
            message: `Process exited unexpectedly: ${err.message}`,
          });
          continue;
        }
      } finally {
        logger.debug("[remote]: launch finally");
        lastResultData = null;
        // Clear per-iteration so a later genuine user abort can't inherit it.
        strandColdRestart = false;

        // Stop mid-turn drain and clear push function to prevent stale pushes
        stopMidTurnDrain();
        midTurnPushFn = null;

        // The PTY process for this launch iteration is gone — stop the
        // stranded-turn watchdog (a fresh turn re-arms it via dispatchTurn).
        stopTurnWatchdog();

        // Clear query reference immediately to prevent stale interrupt/stopTask calls
        currentQuery = null;

        // Stop the per-session HTTP MCP server bound to this launch iteration.
        try {
          stopHappyHttp();
        } catch (err) {
          logger.debug(`[happyMCP] stop error: ${err}`);
        }

        // Terminate all ongoing tool calls
        for (let [toolCallId, { parentToolCallId }] of ongoingToolCalls) {
          const converted = jsonlToLogConverter.generateInterruptedToolResult(
            toolCallId,
            parentToolCallId,
          );
          if (converted) {
            logger.debug(
              "[remote]: terminating tool call " +
                toolCallId +
                " parent: " +
                parentToolCallId,
            );
            session.client.sendClaudeSessionMessage(converted);
          }
        }
        ongoingToolCalls.clear();

        // Knowledge base: flush any pending turns before session teardown
        // Wrapped in try-catch to never block session cleanup
        try {
          if (turnCollector) {
            const finalTurns = turnCollector.flush();
            if (finalTurns) {
              logger.debug(`[knowledge] Flushing ${finalTurns.length} pending turns on exit`);
              for (const turn of finalTurns) {
                session.client.submitKnowledge({
                  entryType: inferEntryType(turn.userMessage, turn.assistantText),
                  contributorType: "session",
                  action: "create",
                  title: turn.userMessage.split("\n")[0].slice(0, 200) || "Session activity",
                  content: turn.assistantText.slice(0, 4000),
                  request: turn.userMessage.slice(0, 500),
                  outcome: turn.fileEdits.length > 0
                    ? `Modified ${turn.fileEdits.length} file(s): ${turn.fileEdits.map((f) => f.path).join(", ").slice(0, 500)}`
                    : undefined,
                  tags: extractTags(turn.fileEdits),
                  confidence: turn.outputTokens > 1000 ? "high" : "medium",
                  model: turn.model,
                  affectedFiles: turn.fileEdits.map((f) => f.path),
                });
              }
            }

            // Generate and submit session-end summary (respects project config toggle)
            const summary = summaryEnabled ? turnCollector.buildSessionSummary() : null;
            if (summary) {
              logger.debug(`[knowledge] Submitting session summary (${summary.fileEdits.length} files, ${summary.outputTokens} tokens)`);
              session.client.submitKnowledge({
                entryType: "summary",
                contributorType: "session",
                action: "create",
                title: summary.userMessage.slice(0, 200) || "Session summary",
                content: summary.assistantText.slice(0, 4000),
                tags: extractTags(summary.fileEdits),
                confidence: "high",
                model: summary.model,
                affectedFiles: summary.fileEdits.map((f) => f.path),
              });
            }
          }
        } catch (err) {
          logger.debug(`[knowledge] Error flushing turns on exit: ${err}`);
        }

        // Stop all task-log watchers
        try {
          const { stopAll } = await import("@/modules/taskLog/taskLogWatcher");
          stopAll();
        } catch {
          // ignore — module may not have been loaded
        }

        // Flush any remaining messages in the queue
        logger.debug("[remote]: flushing message queue");
        await messageQueue.flush();
        messageQueue.destroy();
        logger.debug("[remote]: message queue flushed");

        // Abort old controller to terminate the previous Claude child process
        // This is critical for ExitPlanMode: claudeRemote returns via isAborted
        // but without aborting the controller, the old child process keeps running
        // and conflicts with the new one that resumes the same session.
        if (controller && !controller.signal.aborted) {
          logger.debug(
            "[remote]: aborting previous controller to kill old child process",
          );
          controller.abort();
        }

        // Reset abort controller and future
        abortController = null;
        abortFuture?.resolve(undefined);
        abortFuture = null;
        logger.debug("[remote]: launch done");
        permissionHandler.reset();
        modeHash = null;
        mode = null;
        currentColdHash = null;
      }
    }
  } finally {
    // Drain any pending elicitations to prevent Promise/listener leaks
    for (const [_id, { reject }] of pendingElicitations) {
      reject(new Error("Session ended"));
    }
    pendingElicitations.clear();

    // Clean up permission handler
    permissionHandler.reset();

    // Reset Terminal
    process.stdin.off("data", abort);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    if (inkInstance) {
      inkInstance.unmount();
    }
    messageBuffer.clear();

    // Resolve abort future
    if (abortFuture) {
      // Just in case of error
      abortFuture.resolve(undefined);
    }

    stopTurnWatchdog();
    executionGuard.close();
  }

  return exitReason || "exit";
}
