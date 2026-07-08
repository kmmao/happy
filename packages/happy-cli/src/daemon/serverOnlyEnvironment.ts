/**
 * Server-internal secrets that must NEVER leak into a spawned child process
 * (Claude launcher, Codex, a profile startup script, etc.). A Claude tool call
 * such as Bash `printenv` runs inside that child, so any of these left in its
 * environment would expose operator infrastructure credentials.
 *
 * This is a security invariant, not a per-context filtering rule (see ADR-0073
 * for why the *filtering* stays per-context). The list itself is context-free
 * and has exactly one owner here — every spawn path imports it rather than
 * re-declaring it, so the invariant cannot drift between call sites.
 */
export const SERVER_ONLY_ENV_VARS = new Set([
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "GITHUB_CLIENT_SECRET",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SESSION_TOKEN",
  "STRIPE_SECRET_KEY",
  "SENDGRID_API_KEY",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
]);
