/**
 * Helpers for the session cwd label rendered in the AgentInput action
 * toolbar (previously the ChatHeaderView third line). Live outside the
 * .tsx so vitest can test them without an RN environment.
 *
 * Two formatters:
 *
 * - `formatActiveCwd(activeCwd, launchPath)` — narrowly returns a
 *   *relative-to-launch* label when Claude has actually moved out of the
 *   launch dir. Empty string when activeCwd is missing or equals
 *   launchPath (caller treats as "suppress").
 *
 * - `formatSessionCwdLabel(activeCwd, launchPath)` — wider "always show
 *   something" rule used by the AgentInput chip: prefer the
 *   relative-to-launch label when available, otherwise the basename of
 *   launchPath, otherwise the basename of activeCwd, otherwise "".
 *
 * `metadata.activeCwd` (Claude Code 2.1.121+ CwdChanged hook) can be deep
 * inside the launch directory, a sibling, or anywhere on disk. We render
 * it relative to `launchPath` whenever that produces a more compact label:
 *
 *   activeCwd === launchPath       → "" (caller suppresses the row)
 *   activeCwd inside launchPath    → "./<relative>"
 *   activeCwd elsewhere            → "…/<parent>/<name>"
 *   no parent context to abbreviate → activeCwd verbatim
 *
 * Handles both POSIX `/` and Windows `\` separators; we don't normalize
 * because the CLI ships whatever the host OS reported.
 */
export function formatActiveCwd(
  activeCwd: string,
  launchPath: string | undefined,
): string {
  if (!activeCwd) return "";
  if (launchPath) {
    if (activeCwd === launchPath) return "";
    if (
      activeCwd.startsWith(launchPath + "/") ||
      activeCwd.startsWith(launchPath + "\\")
    ) {
      return `./${activeCwd.slice(launchPath.length + 1)}`;
    }
  }
  const sep = activeCwd.includes("/") ? "/" : "\\";
  const parts = activeCwd.split(sep).filter(Boolean);
  if (parts.length <= 2) return activeCwd;
  return `…${sep}${parts.slice(-2).join(sep)}`;
}

/**
 * Always returns a short cwd label when any path data exists. Used by
 * the AgentInput chip so the user can see "where am I" even when Claude
 * hasn't moved out of the launch directory.
 *
 * Resolution order:
 *   1. activeCwd outside launchPath        → formatActiveCwd result
 *      (`./sub`, `…/sibling/x`, or verbatim)
 *   2. launchPath present                  → its basename ("gs-frontend")
 *   3. activeCwd present but no launchPath → its basename
 *   4. nothing                              → ""
 */
export function formatSessionCwdLabel(
  activeCwd: string | undefined,
  launchPath: string | undefined,
): string {
  // Only delegate to formatActiveCwd when BOTH paths exist — otherwise it
  // returns the activeCwd verbatim (e.g. "/etc/nginx"), which is too long
  // for the inline chip. Without launchPath we want the basename instead.
  if (activeCwd && launchPath && activeCwd !== launchPath) {
    const rel = formatActiveCwd(activeCwd, launchPath);
    if (rel) return rel;
  }
  if (launchPath) {
    return basename(launchPath);
  }
  if (activeCwd) {
    return basename(activeCwd);
  }
  return "";
}

function basename(path: string): string {
  const sep = path.includes("/") ? "/" : "\\";
  const parts = path.split(sep).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
