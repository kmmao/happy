/**
 * Bash command security policy — blocks RPC shell commands that would exfiltrate
 * secrets (environment variables, credential files).
 *
 * Extracted from `registerFilesystemHandlers.ts`, where the blocklist and its
 * check were private and reached only by the `bash` handler lambda, so the rules
 * had no test surface — verifying that, say, `printenv` or a `$ANTHROPIC_API_KEY`
 * reference is blocked meant standing up the whole RpcHandlerManager. As its own
 * module the policy is directly testable: each pattern is a security claim that
 * deserves a test. Mirrors happy-agent's `api/rpc/bashCommandPolicy.ts` (the two
 * packages cannot import each other; the sensitive-var check differs — the CLI
 * composes the dynamic `findSensitiveEnvVarReferences` scanner rather than a
 * static name regex).
 *
 * The patterns target three exfiltration shapes: env-dumping builtins
 * (`printenv`, `env`, `set`, `export -p`, `compgen -e`, `declare -x`,
 * `/proc/<pid>/environ`), reads of named sensitive variables (delegated to
 * `findSensitiveEnvVarReferences`), and reads of credential files (`.env*`,
 * `~/.aws/credentials`, `.netrc`).
 */
import { findSensitiveEnvVarReferences } from "./securityRedaction";

export interface BlockedBashPattern {
  pattern: RegExp;
  reason: string;
}

export const BLOCKED_BASH_PATTERNS: ReadonlyArray<BlockedBashPattern> = [
  // Direct env var reading
  { pattern: /\bprintenv\b/i, reason: "printenv is blocked for security" },
  { pattern: /\benv\b(?:\s|$|;|\|)/i, reason: "env command is blocked for security" },
  { pattern: /\bset\b\s*(?:$|;|\|)/i, reason: "set (list env) is blocked for security" },
  { pattern: /\bexport\s+-p\b/i, reason: "export -p is blocked for security" },
  { pattern: /\bcompgen\s+-e\b/i, reason: "compgen -e is blocked for security" },
  { pattern: /\bdeclare\s+-x\b/i, reason: "declare -x is blocked for security" },
  // Reading process environment from procfs or equivalent
  { pattern: /\/proc\/[^/]*\/environ/i, reason: "reading /proc/environ is blocked for security" },
  // Reading common credential files
  { pattern: /\.(env|env\.local|env\.prod|env\.production|env\.dev)\b/i, reason: "reading .env files is blocked for security" },
  { pattern: /\.aws\/credentials/i, reason: "reading AWS credentials is blocked for security" },
  { pattern: /\.netrc/i, reason: "reading .netrc is blocked for security" },
];

/**
 * Check if a bash command matches any blocked pattern or references a sensitive
 * environment variable. Returns the reason string if blocked, or null if allowed.
 */
export function checkBlockedBashCommand(command: string): string | null {
  for (const { pattern, reason } of BLOCKED_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return reason;
    }
  }
  const sensitiveEnvVars = findSensitiveEnvVarReferences(command);
  if (sensitiveEnvVars.length > 0) {
    return `accessing sensitive environment variables is blocked (${sensitiveEnvVars.join(", ")})`;
  }
  return null;
}
