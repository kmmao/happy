# 0028 — Permission lifecycle lives in BasePermissionHandler; Claude stays separate

## Decision

`BasePermissionHandler` owns the whole tool-approval lifecycle for the Codex,
Gemini, and ACP Providers: pending-request map, 'permission' RPC response
handling, session-swap rebinding, reset, and both decision paths
(`requestPermission` interactive / `recordAutoApproval` auto-approve).
Provider subclasses contribute only their auto-approval policy and the
decision value ('approved' vs 'approved_for_session').

Claude's `claude/utils/permissionHandler.ts` deliberately does NOT extend this
base. Its interface differs in kind, not detail: permission-mode computation,
decision classifications on the RPC response, allowedTools tracking, and
plan-mode fake-restart. Hoisting those into the base would widen the base
interface to the union of all providers — a shallow module. Revisit only if a
second Provider needs Claude-grade mode semantics (two adapters = real seam).
