/**
 * Auto Mode safety classifier.
 *
 * Powers the "auto" permission mode: a pure, side-effect-free classifier that
 * labels each tool call as
 *
 *   - "safe"      → read-only / non-destructive. Auto Mode silently allows it,
 *                   eliminating permission-popup fatigue for the 90% of calls
 *                   that only read state.
 *   - "dangerous" → could damage the system / repo / remote (rm -rf, git push,
 *                   piping curl to a shell, writing to sensitive paths…). Auto
 *                   Mode force-routes these through the App approval flow and
 *                   the App flags them.
 *   - "neutral"   → everything in between (ordinary file edits, unknown Bash).
 *                   Falls through to the normal approval flow — never silently
 *                   allowed, never specially flagged.
 *
 * Kept as a pure function (no Session / IO coupling) so the policy is a single
 * unit-testable seam, mirroring `allowedToolMatcher` / `disallowedTools`.
 */

export type RiskLevel = "safe" | "dangerous" | "neutral";

export interface Classification {
  risk: RiskLevel;
  /** Short human-readable justification, surfaced to the App for danger cards. */
  reason: string;
}

/** Tools that only observe state — never mutate the filesystem or remote. */
const SAFE_READONLY_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "NotebookRead",
  "TodoRead",
  "WebFetch",
  "WebSearch",
]);

/** Tools that write to disk — neutral by default, dangerous for sensitive paths. */
const EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
]);

/**
 * Command heads that are read-only. A Bash command is "safe" only when EVERY
 * sub-command (split on shell operators) starts with one of these AND no
 * dangerous pattern matches. Conservative on purpose: an unknown head → neutral,
 * not safe.
 */
const READONLY_BASH_HEADS: ReadonlySet<string> = new Set([
  "ls", "cat", "head", "tail", "wc", "pwd", "echo", "printf", "which", "type",
  "whoami", "id", "hostname", "uname", "date", "env", "printenv", "tree",
  "stat", "file", "basename", "dirname", "realpath", "readlink", "df", "du",
  "ps", "top", "uptime", "cksum", "md5sum", "sha256sum", "true", "false",
  "grep", "rg", "egrep", "fgrep", "find", "fd", "sort", "uniq", "cut", "column",
  "diff", "cmp", "jq", "yq", "column", "tldr", "man", "help",
]);

/**
 * Read-only `git` subcommands. `git <sub>` is safe only when <sub> is here.
 * Mutating/destructive git verbs (push, reset --hard, clean, restore, branch -D)
 * are caught earlier by DANGEROUS_BASH_PATTERNS.
 */
const READONLY_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "status", "diff", "log", "show", "branch", "remote", "rev-parse", "describe",
  "ls-files", "ls-remote", "blame", "shortlog", "reflog", "cat-file",
  "whatchanged", "diff-tree", "name-rev", "symbolic-ref", "tag", "grep",
]);

/**
 * Regexes for genuinely destructive / exfiltrating / privilege-escalating
 * commands. Any match anywhere in the command string → dangerous.
 */
const DANGEROUS_BASH_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+(-[a-z]*\s+)*-?[a-z]*[rf]/i, reason: "recursive/forced file deletion (rm)" },
  { re: /\brmdir\b/i, reason: "directory removal (rmdir)" },
  { re: /\bsudo\b/i, reason: "privilege escalation (sudo)" },
  { re: /\bsu\s+-/i, reason: "privilege escalation (su)" },
  { re: /\bmkfs\b/i, reason: "filesystem format (mkfs)" },
  { re: /\bdd\s+.*\bof=/i, reason: "raw disk write (dd)" },
  { re: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i, reason: "system power control" },
  { re: /\bkill(all)?\b|\bpkill\b/i, reason: "process termination" },
  { re: /\bchmod\s+(-R\s+)?0?777\b/i, reason: "world-writable permission change" },
  { re: /\bchown\b.*\b-R\b/i, reason: "recursive ownership change" },
  { re: /\bcurl\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, reason: "pipe remote script to shell (curl | sh)" },
  { re: /\bwget\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, reason: "pipe remote script to shell (wget | sh)" },
  { re: /:\(\)\s*\{.*\}\s*;\s*:/, reason: "fork bomb" },
  { re: /\bgit\s+push\b/i, reason: "push to remote (git push)" },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: "destructive git reset --hard" },
  { re: /\bgit\s+clean\b/i, reason: "git clean removes untracked files" },
  { re: /\bgit\s+checkout\s+--\s|\bgit\s+restore\b/i, reason: "discard local changes (git restore/checkout)" },
  { re: /\bgit\s+branch\s+-D\b/i, reason: "force-delete branch (git branch -D)" },
  { re: /\bnpm\s+publish\b|\byarn\s+publish\b/i, reason: "publish package to registry" },
  { re: />\s*\/(etc|usr|bin|sbin|boot|dev|sys|proc)\b/i, reason: "redirect into a system path" },
  { re: /\b(rm|mv|cp)\b[^|;&]*\s\/(etc|usr|bin|sbin|boot|dev|sys)\b/i, reason: "mutate a system path" },
];

/** Sensitive path fragments that make an edit/write dangerous. */
const SENSITIVE_PATH_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /(^|\/)\.ssh(\/|$)/i, reason: "SSH key/config" },
  { re: /(^|\/)\.aws(\/|$)/i, reason: "AWS credentials" },
  { re: /(^|\/)\.env(\.|$)/i, reason: "environment secrets (.env)" },
  { re: /(^|\/)\.git\/(config|hooks)(\/|$)/i, reason: "git internals" },
  { re: /^\/(etc|usr|bin|sbin|boot|dev|sys|proc)(\/|$)/i, reason: "system path" },
  { re: /(^|\/)id_(rsa|ed25519|ecdsa|dsa)\b/i, reason: "private key" },
];

/** Split a Bash command into sub-commands on shell operators. */
function splitBashCommand(command: string): string[] {
  return command
    .split(/(?:&&|\|\||[|;&\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** First bare word of a sub-command (its executable), lowercased. */
function commandHead(sub: string): string {
  // Strip leading env-var assignments (FOO=bar cmd ...).
  const withoutAssignments = sub.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
  const first = withoutAssignments.trim().split(/\s+/)[0] ?? "";
  return first.replace(/^["']|["']$/g, "").toLowerCase();
}

/** Second bare word of a sub-command (e.g. the git subcommand), lowercased. */
function commandSecondWord(sub: string): string {
  const withoutAssignments = sub.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
  const parts = withoutAssignments.trim().split(/\s+/);
  return (parts[1] ?? "").replace(/^["']|["']$/g, "").toLowerCase();
}

/** True when a single sub-command only observes state. */
function isReadonlySubCommand(sub: string): boolean {
  const head = commandHead(sub);
  if (head === "git") {
    return READONLY_GIT_SUBCOMMANDS.has(commandSecondWord(sub));
  }
  return READONLY_BASH_HEADS.has(head);
}

function classifyBash(input: unknown): Classification {
  const command = (input as { command?: string } | null)?.command;
  if (typeof command !== "string" || command.trim() === "") {
    return { risk: "neutral", reason: "empty or unparsable Bash command" };
  }

  for (const { re, reason } of DANGEROUS_BASH_PATTERNS) {
    if (re.test(command)) {
      return { risk: "dangerous", reason };
    }
  }

  const subs = splitBashCommand(command);
  if (subs.length > 0 && subs.every(isReadonlySubCommand)) {
    return { risk: "safe", reason: "read-only shell command" };
  }

  return { risk: "neutral", reason: "shell command requires review" };
}

function classifyEdit(toolName: string, input: unknown): Classification {
  const path =
    (input as { file_path?: string; notebook_path?: string } | null)?.file_path ??
    (input as { notebook_path?: string } | null)?.notebook_path;
  if (typeof path === "string") {
    for (const { re, reason } of SENSITIVE_PATH_PATTERNS) {
      if (re.test(path)) {
        return { risk: "dangerous", reason: `writes to ${reason}` };
      }
    }
  }
  return { risk: "neutral", reason: `${toolName} modifies files` };
}

/**
 * Classify a single tool call. Pure — depends only on its arguments.
 */
export function classifyToolCall(toolName: string, input: unknown): Classification {
  if (SAFE_READONLY_TOOLS.has(toolName)) {
    return { risk: "safe", reason: "read-only tool" };
  }
  if (toolName === "Bash") {
    return classifyBash(input);
  }
  if (EDIT_TOOLS.has(toolName)) {
    return classifyEdit(toolName, input);
  }
  return { risk: "neutral", reason: "requires review" };
}
