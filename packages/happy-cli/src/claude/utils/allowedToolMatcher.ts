/**
 * Allowed-tool matcher — the pure "is this tool already granted?" seam lifted
 * out of `PermissionHandler`.
 *
 * When the user grants a tool session-wide (the App's "always allow" path) the
 * grant arrives as a permission string: a plain tool name (`"Read"`), or a Bash
 * pattern (`"Bash(git status)"` literal, `"Bash(npm run:*)"` prefix). Before a
 * later tool call reaches the approval flow the handler asks whether it was
 * already granted. That decision used to live in two disconnected places inside
 * `PermissionHandler` — `parseBashPermission` on the grant side and an inline
 * literal/prefix scan on the check side — with no test coverage, so a bug in the
 * `:*` prefix handling could silently auto-approve (or fail to approve) a Bash
 * command. Consolidating both halves behind one interface makes the grant/check
 * invariant a single testable seam (in-process pure, no Session coupling).
 */

export type AllowedToolMatcher = {
  /**
   * Record a session-wide grant. Accepts a plain tool name or a `Bash(...)`
   * pattern; plain `"Bash"` and unparseable strings are ignored (matching the
   * prior inline behaviour).
   */
  grant(tool: string): void;
  /** True when a subsequent `(toolName, input)` call is already covered by a grant. */
  isPreAllowed(toolName: string, input: unknown): boolean;
  /** Forget every grant (session reset). */
  clear(): void;
};

const BASH_PATTERN = /^Bash\((.+?)\)$/;

export function createAllowedToolMatcher(): AllowedToolMatcher {
  const allowedTools = new Set<string>();
  const allowedBashLiterals = new Set<string>();
  const allowedBashPrefixes = new Set<string>();

  function grantBash(permission: string): void {
    // Ignore plain "Bash".
    if (permission === "Bash") {
      return;
    }
    const match = permission.match(BASH_PATTERN);
    if (!match) {
      return;
    }
    const command = match[1];
    if (command.endsWith(":*")) {
      allowedBashPrefixes.add(command.slice(0, -2)); // Remove :*
    } else {
      allowedBashLiterals.add(command);
    }
  }

  return {
    grant(tool: string): void {
      if (tool.startsWith("Bash(") || tool === "Bash") {
        grantBash(tool);
      } else {
        allowedTools.add(tool);
      }
    },

    isPreAllowed(toolName: string, input: unknown): boolean {
      if (toolName === "Bash") {
        const command = (input as { command?: string } | null)?.command;
        if (!command) {
          return false;
        }
        if (allowedBashLiterals.has(command)) {
          return true;
        }
        for (const prefix of allowedBashPrefixes) {
          if (command.startsWith(prefix)) {
            return true;
          }
        }
        return false;
      }
      return allowedTools.has(toolName);
    },

    clear(): void {
      allowedTools.clear();
      allowedBashLiterals.clear();
      allowedBashPrefixes.clear();
    },
  };
}
