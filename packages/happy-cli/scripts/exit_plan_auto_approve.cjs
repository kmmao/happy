#!/usr/bin/env node
/**
 * ExitPlanMode auto-approve hook (Claude TUI `PreToolUse`).
 *
 * Why this exists
 * ---------------
 * In Yolo / bypassPermissions PTY sessions Claude TUI STILL renders the
 * interactive "Ready to code?" confirmation picker for ExitPlanMode.
 * bypassPermissions is deliberately NOT one of the conditions that make the
 * tool's own `checkPermissions` return "allow" (verified against the 2.1.150
 * binary: only an in-process subagent async-context — `I68.getStore()` — or a
 * team-agent context flips it). So in a normal remote session the picker
 * always appears.
 *
 * That picker also embeds a free-text "tell Claude what to change" input.
 * Happy used to auto-confirm it by blindly writing "1\r" to the PTY. With no
 * reliable picker-ready signal that keystroke landed in the TEXT field, and
 * the trailing CR submitted "1" as plan feedback — which Claude reads as
 * "the user wants changes" and REJECTS the tool:
 *     tool_result is_error:true "The user doesn't want to proceed..."
 *     → "[Request interrupted by user for tool use]"
 * (Observed identically in PIDs 67654 and 50704.)
 *
 * The robust fix is this hook. IMPORTANT subtlety: ExitPlanMode is a
 * `requiresUserInteraction()` tool. The binary's hook pipeline (function XX6)
 * falls back to the FULL permission prompt for such tools unless the allow
 * decision also carries `updatedInput`:
 *
 *     if (decision==="allow" && (requiresUserInteraction && !hasUpdatedInput || requireCanUseTool))
 *         → run full permission pipeline   // picker still shows!
 *     if (decision==="allow")
 *         → "Hook satisfied user interaction via updatedInput, bypassing prompt"
 *
 * So a bare `permissionDecision:"allow"` is silently ignored — we MUST echo
 * the tool_input back verbatim as `updatedInput`. (`requireCanUseTool` is
 * false in Happy's PTY/TUI mode: there is no SDK `canUseTool` callback.)
 *
 * stdin  (Claude PreToolUse hook JSON):
 *   { "tool_name": "ExitPlanMode", "tool_input": { "plan": "..." }, ... }
 * stdout (approve + echo input → bypass picker):
 *   { "hookSpecificOutput": { "hookEventName": "PreToolUse",
 *       "permissionDecision": "allow", "updatedInput": <tool_input> } }
 *
 * Failure posture: any parse/shape problem emits nothing and exits 0, so the
 * TUI simply falls back to its picker (same behaviour as before this hook) —
 * never worse than the status quo.
 */

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    const parsed = JSON.parse(raw);

    // Defense-in-depth: the settings matcher already scopes us to
    // ExitPlanMode, but if a broader matcher ever routes another tool here we
    // must not auto-approve it. Emit nothing → normal permission flow.
    if (parsed && parsed.tool_name && parsed.tool_name !== "ExitPlanMode") {
      process.exit(0);
    }

    const toolInput =
      parsed && typeof parsed.tool_input === "object" && parsed.tool_input
        ? parsed.tool_input
        : {};

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason:
            "Auto-approved by Happy: remote sessions have no in-terminal picker channel",
          // MUST be present for requiresUserInteraction tools — see header.
          updatedInput: toolInput,
        },
      }),
    );
  } catch {
    // Malformed stdin → fall back to the TUI picker (no output).
  }
  process.exit(0);
});
