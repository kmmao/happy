---
status: accepted
---

# `sync/ops.ts` error convention — result-object for fallible UI ops, throw for must-succeed mutations

## Decision

`packages/happy-app/sources/sync/ops.ts` is a typed facade over `apiSocket.machineRPC` / session RPC (one thin function per remote method — see [ADR-0009](0009-spawnsession-result-not-fully-unified.md) for why the *types* stay package-local). Its ~100 functions historically reported failure four different ways (try/catch → `{ success: false }`, `throw new Error(result.error)`, bare pass-through, unwrap-and-throw), so a caller had to read each function to know whether to `try/catch` or inspect a result flag.

We **keep two conventions, chosen by intent — not a single uniform style** (a blanket sweep was considered and rejected):

1. **Fallible, UI-surfaced op → return a result object.** When the operation is expected to fail in normal use and the failure is shown to the Account (bash output, tunnel add, git scan, doctor clean), report failure as a value: `{ success: false, error, ...opSpecificFields }`. These go through the **`tryMachineOp(op, onError)`** seam, which owns the `try → getErrorMessage → fallback` skeleton; each op supplies its own `onError` so it keeps its own result contract. New fallible ops MUST use `tryMachineOp`.
2. **Must-succeed mutation → throw.** When the caller has no meaningful per-failure UI and a failure is exceptional (create/delete webhook, version preconditions), `throw` and let `useHappyAction` surface it.

## Considered options

- *Unify all ~100 functions onto one convention.* Rejected: the result-object vs throw split is a genuine per-operation contract (a fallible op that the UI renders inline wants a value; a must-succeed mutation wants an exception). Forcing one style would either bury real failures (throw-only) or push `if (!result.success)` boilerplate into every call site (result-only), and the rewrite would touch every caller for no behavioural gain. The fragmentation was a *missing rule*, not a missing abstraction.

## Consequences

- The "which convention?" question is answered by intent, not by reading each function. `tryMachineOp` is the one home for the result-object skeleton; the magic of "thrown transport error becomes this op's failure value" lives in one place.
- The bespoke failure *shape* still lives with each op (it is part of that op's return type); `tryMachineOp` is type-checked to return exactly that shape.
- A future architecture review proposing "unify ops.ts error handling" should read this first — the two-convention split is intentional.
