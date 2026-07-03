/**
 * Codex approval helpers — the pure id-resolution shared by
 * `CodexAppServerClient`'s permission-approval handlers.
 *
 * Every app-server approval request carries an optional per-call id (`callId`,
 * `itemId`, …) that should key the permission request, falling back to the
 * transport `requestKey` when the field is absent or empty. Four handlers
 * hand-rolled the same `typeof x === "string" && x.length > 0 ? x : fallback`
 * check on different field names; this concentrates that rule so a caller just
 * names the field. Pure — no client state — so it is unit-tested directly.
 */
export function pickPermissionId(
  params: Record<string, unknown>,
  field: string,
  fallback: string,
): string {
  const value = params[field];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
