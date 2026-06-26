---
status: accepted
---

# Agent RPC security policies are their own testable seams

## Rule

In `packages/happy-agent`, each security policy enforced by the RPC file/shell
handlers lives in its own exported module with its own tests, not as a private
function inside `registerHandlers.ts`:

- `src/api/rpc/pathValidation.ts` — `validatePath` (directory-confinement +
  symlink-escape check), reached by ~8 handlers.
- `src/api/rpc/bashCommandPolicy.ts` — `BLOCKED_BASH_PATTERNS` +
  `checkBlockedBashCommand` (secret-exfiltration blocklist), reached by the
  `bash` handler.

## Trigger

Both policies were private functions in the ~985-line `registerHandlers.ts`.
Being un-exported, security-critical code had **no test surface**: exercising a
traversal/symlink escape or a `$ANTHROPIC_API_KEY` exfiltration attempt meant
standing up the whole `RpcHandlerManager`. Each is a deep seam (one
implementation, many call sites / many security claims) trapped inside a grab-bag.

## Decision

- Extract the two policies to their own modules and export them.
- Pin them with direct tests: `pathValidation.test.ts` (working-dir confinement,
  parent traversal, absolute escape, **symlink real-target escape**, allowed
  extra dir, non-existent-file parent) and `bashCommandPolicy.test.ts` (each
  blocked pattern + non-sensitive allow cases).
- `registerHandlers.ts` keeps the handler bodies (bash exec, file ops) inline and
  calls the extracted policies.

## Deliberately NOT done

Splitting every handler body (bash exec, readFile, writeFile, listDirectory, …)
into its own per-handler module. Those lambdas close over
`(workingDirectory, sessionId, rpcHandlerManager)` and are already cohesive; a
full explosion threads those dependencies through N new modules for modest depth
gain. The leverage and the test value concentrated in the **security policies**,
not the I/O bodies. Future architecture reviews should not re-suggest the
wholesale handler split as high-value — the policies were the deep parts.

## Re-evaluate when

- A handler body grows its own non-trivial, independently-testable policy (as the
  security checks had) — extract that policy, following this pattern.

## Affected

`packages/happy-agent/src/api/rpc/pathValidation.ts` (+ test),
`bashCommandPolicy.ts` (+ test), `registerHandlers.ts` (985 → 877 lines).
