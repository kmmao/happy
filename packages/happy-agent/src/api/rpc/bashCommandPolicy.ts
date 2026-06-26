/**
 * Bash command security policy — blocks RPC shell commands that would exfiltrate
 * secrets (environment variables, credential files).
 *
 * Extracted from `registerHandlers.ts`, where the blocklist and its check were
 * private and reached only by the `bash` handler lambda, so the rules had no
 * test surface — verifying that, say, `printenv` or a `$ANTHROPIC_API_KEY`
 * reference is blocked meant standing up the whole RpcHandlerManager. As its own
 * module the policy is directly testable: each pattern is a security claim that
 * deserves a test.
 *
 * The patterns target three exfiltration shapes: env-dumping builtins
 * (`printenv`, `env`, `set`, `export -p`, `compgen -e`, `declare -x`,
 * `/proc/<pid>/environ`), direct reads of named sensitive variables, and reads
 * of credential files (`.env*`, `~/.aws/credentials`, `.netrc`).
 */

export interface BlockedBashPattern {
    pattern: RegExp;
    reason: string;
}

export const BLOCKED_BASH_PATTERNS: ReadonlyArray<BlockedBashPattern> = [
    { pattern: /\bprintenv\b/i, reason: "printenv is blocked for security" },
    {
        pattern: /\benv\b(?:\s|$|;|\|)/i,
        reason: "env command is blocked for security",
    },
    {
        pattern: /\bset\b\s*(?:$|;|\|)/i,
        reason: "set (list env) is blocked for security",
    },
    {
        pattern: /\bexport\s+-p\b/i,
        reason: "export -p is blocked for security",
    },
    {
        pattern: /\bcompgen\s+-e\b/i,
        reason: "compgen -e is blocked for security",
    },
    {
        pattern: /\bdeclare\s+-x\b/i,
        reason: "declare -x is blocked for security",
    },
    {
        pattern: /\/proc\/[^/]*\/environ/i,
        reason: "reading /proc/environ is blocked for security",
    },
    {
        pattern:
            /\$\{?\s*(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_BASE_URL|OPENAI_API_KEY|OPENAI_BASE_URL|DATABASE_URL|REDIS_URL|JWT_SECRET|ENCRYPTION_KEY|AWS_SECRET_ACCESS_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|TOGETHER_API_KEY|GITHUB_CLIENT_SECRET|CLAUDE_CODE_OAUTH_TOKEN)\b/i,
        reason: "accessing sensitive environment variables is blocked",
    },
    {
        pattern: /\.(env|env\.local|env\.prod|env\.production|env\.dev)\b/i,
        reason: "reading .env files is blocked for security",
    },
    {
        pattern: /\.aws\/credentials/i,
        reason: "reading AWS credentials is blocked for security",
    },
    {
        pattern: /\.netrc/i,
        reason: "reading .netrc is blocked for security",
    },
];

/**
 * Returns the block reason for a command, or null if it is allowed.
 */
export function checkBlockedBashCommand(command: string): string | null {
    for (const { pattern, reason } of BLOCKED_BASH_PATTERNS) {
        if (pattern.test(command)) {
            return reason;
        }
    }
    return null;
}
