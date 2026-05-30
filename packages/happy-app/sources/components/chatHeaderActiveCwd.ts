/**
 * Helper for ChatHeaderView's third line — Claude's live working directory.
 * Lives outside the .tsx so vitest can test it without an RN environment.
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
