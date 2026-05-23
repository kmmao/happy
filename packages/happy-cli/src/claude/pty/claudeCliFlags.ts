/**
 * claudeCliFlags — translate an `EnhancedMode` (plus session-level
 * boot options) into a `string[]` of CLI flags for `claude`.
 *
 * Why a dedicated translator?
 * ---------------------------
 * The current SDK path (`queryAdapter.ts`) maps Happy's `EnhancedMode`
 * into the SDK's `Options` bag, which the SDK then re-serializes into
 * the actual `claude` argv. After the PTY migration we spawn `claude`
 * ourselves — so we own the argv directly. This module is the single
 * place to keep that mapping honest.
 *
 * Mapping table (frozen by PTY migration plan)
 * --------------------------------------------
 *   permissionMode        → --permission-mode <mode>    (boot-only; runtime swap = cold restart)
 *   model                 → --model <model>             (boot-only; runtime swap = `/model …` slash command)
 *   fallbackModel         → --fallback-model <model>
 *   appendSystemPrompt    → --append-system-prompt <text>   (also exposed as env HAPPY_APPEND_SYSTEM_PROMPT)
 *   allowedTools          → --allowedTools a,b,c
 *   disallowedTools       → --disallowedTools a,b,c
 *   additionalDirectories → --add-dir <path>            (repeated per directory)
 *   betas                 → --betas a,b
 *   continue              → --continue
 *   resume                → --resume <session-uuid>
 *   sessionId             → --session-id <uuid>
 *   mcpServers            → --mcp-config <json>
 *   settingsPath / settings (string)
 *                         → --settings <path>
 *   allowDangerouslySkipPermissions
 *                         → --dangerously-skip-permissions
 *
 *   thinking / effort / taskBudget / outputFormat / shouldQuery / hooks /
 *   plugins / customSystemPrompt / agents
 *                         → ⚠️ no equivalent claude CLI flag — emitted as a
 *                              `logger.warn` so we surface visibility loss
 *                              instead of dropping silently. customSystemPrompt
 *                              and per-agent definitions belong in the
 *                              temporary settings.json that the caller
 *                              composes (see generateHookSettings.ts).
 */

import type { EnhancedMode } from "@/claude/loop";
import { logger } from "@/ui/logger";

export interface ClaudeCliFlagsInput {
  /** Mode-derived options (model, permissionMode, allowedTools, …). */
  mode?: EnhancedMode;
  /** Path to the temporary hook settings JSON (becomes --settings). */
  settingsPath?: string;
  /** Map of MCP servers (becomes --mcp-config JSON). */
  mcpServers?: Record<string, unknown>;
  /** Resume from an existing session id (UUID). */
  resumeSessionId?: string;
  /** Fresh session id to use for a new session (UUID). */
  newSessionId?: string;
  /** Extra raw flags appended verbatim at the end. */
  extraArgs?: string[];
}

export interface ClaudeCliFlagsResult {
  /** The argv to pass to `pty.spawn("claude", args, …)`. */
  args: string[];
  /** Capability-loss warnings (one per skipped EnhancedMode field). */
  warnings: string[];
}

/**
 * Produce argv + warnings.
 *
 * Returns `warnings` rather than `logger.warn`-ing inline so that callers
 * can also surface them in their own structured logs / telemetry.
 */
export function buildClaudeCliFlags(
  input: ClaudeCliFlagsInput,
): ClaudeCliFlagsResult {
  const args: string[] = [];
  const warnings: string[] = [];
  const mode = input.mode;

  // ── Session control (boot-time only) ──
  // --resume wins over --session-id when both are supplied.
  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId);
  } else if (input.newSessionId) {
    args.push("--session-id", input.newSessionId);
  }

  // ── Mode-derived flags ──
  if (mode) {
    if (mode.permissionMode && mode.permissionMode !== "default") {
      // Happy maps permissionMode `bypassPermissions` to the
      // --dangerously-skip-permissions flag; otherwise pass --permission-mode.
      if (mode.permissionMode === "bypassPermissions") {
        args.push("--dangerously-skip-permissions");
      } else {
        args.push("--permission-mode", mode.permissionMode);
      }
    }
    if (mode.model) {
      args.push("--model", mode.model);
    }
    if (mode.fallbackModel) {
      args.push("--fallback-model", mode.fallbackModel);
    }
    if (mode.appendSystemPrompt) {
      args.push("--append-system-prompt", mode.appendSystemPrompt);
    }
    if (mode.allowedTools && mode.allowedTools.length > 0) {
      args.push("--allowedTools", mode.allowedTools.join(","));
    }
    if (mode.disallowedTools && mode.disallowedTools.length > 0) {
      args.push("--disallowedTools", mode.disallowedTools.join(","));
    }
    if (mode.additionalDirectories && mode.additionalDirectories.length > 0) {
      for (const dir of mode.additionalDirectories) {
        args.push("--add-dir", dir);
      }
    }
    if (mode.betas && mode.betas.length > 0) {
      args.push("--betas", mode.betas.join(","));
    }
    if (mode.continue) {
      args.push("--continue");
    }

    // ── Capability-loss warnings ──
    if (mode.thinking) {
      warnings.push(
        "EnhancedMode.thinking has no claude CLI flag — config is dropped (set in settings.json if Claude TUI supports it)",
      );
    }
    if (mode.effort != null) {
      warnings.push(
        "EnhancedMode.effort has no claude CLI flag — config is dropped",
      );
    }
    if (mode.taskBudget) {
      warnings.push(
        "EnhancedMode.taskBudget has no claude CLI flag — config is dropped",
      );
    }
    if (mode.outputFormat) {
      warnings.push(
        "EnhancedMode.outputFormat is an SDK-only feature; ignored by claude TUI",
      );
    }
    if (mode.shouldQuery === false) {
      warnings.push(
        "EnhancedMode.shouldQuery=false has no TUI equivalent — message will trigger a normal turn",
      );
    }
    if (mode.customSystemPrompt) {
      warnings.push(
        "EnhancedMode.customSystemPrompt belongs in settings.json `systemPrompt` — pass via input.settingsPath",
      );
    }
    if (mode.agent) {
      warnings.push(
        "EnhancedMode.agent must be defined in settings.json — pass via input.settingsPath",
      );
    }
    if (mode.agents && Object.keys(mode.agents).length > 0) {
      warnings.push(
        "EnhancedMode.agents must be defined in settings.json — pass via input.settingsPath",
      );
    }
    if (mode.plugins && mode.plugins.length > 0) {
      warnings.push(
        "EnhancedMode.plugins must be defined in settings.json — pass via input.settingsPath",
      );
    }
    if (mode.maxBudgetUsd != null) {
      warnings.push(
        "EnhancedMode.maxBudgetUsd has no claude CLI flag — pass via input.settingsPath",
      );
    }
  }

  // ── MCP servers via --mcp-config ──
  // Strip entries flagged `disabled: true` — that field is a Happy-internal
  // annotation (set by markDisabledMcpServers so the PTY controller can
  // report them as `status: 'disabled'` in the App). The Claude CLI's SDK
  // schema does not include `disabled`, so leaking it into the JSON we
  // serialise would either be rejected or, worse, get launched anyway.
  // Claude already honours `~/.claude.json`'s per-project disabled list
  // natively, so omission here matches its expected behaviour.
  if (input.mcpServers && Object.keys(input.mcpServers).length > 0) {
    const filtered: Record<string, unknown> = {};
    for (const [name, config] of Object.entries(input.mcpServers)) {
      if (
        config &&
        typeof config === "object" &&
        !Array.isArray(config) &&
        (config as { disabled?: unknown }).disabled === true
      ) {
        continue;
      }
      filtered[name] = config;
    }
    if (Object.keys(filtered).length > 0) {
      args.push("--mcp-config", JSON.stringify({ mcpServers: filtered }));
    }
  }

  // ── Settings file (hook settings + happy MCP HTTP injection) ──
  if (input.settingsPath) {
    args.push("--settings", input.settingsPath);
  }

  // ── Tail: caller-provided raw flags win ──
  if (input.extraArgs && input.extraArgs.length > 0) {
    args.push(...input.extraArgs);
  }

  // Surface warnings to the debug log so they're not entirely silent for
  // operators inspecting `~/.happy/logs/` even when no caller forwards
  // them.
  for (const w of warnings) {
    logger.debug(`[claudeCliFlags] ${w}`);
  }

  return { args, warnings };
}
