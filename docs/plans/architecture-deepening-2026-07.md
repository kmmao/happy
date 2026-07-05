# Architecture deepening plan — 2026-07

Output of `/improve-codebase-architecture`. 18 raw candidates were surfaced by
exploration across happy-server, happy-app, happy-cli, happy-agent, then filtered
against the 73 existing ADRs and the project's demonstrated anti-premature-
abstraction philosophy ("one adapter = hypothetical seam; two = real seam";
"duplicated until drift").

Several raw candidates directly re-litigated **accepted** ADRs and are rejected
(see Tier C). The remaining candidates are ordered safest-first (tests before
structural refactors).

## Tier A — pure-upside test surface (no ADR conflict, lowest risk)

- **A1 — CLI/Agent RPC security integration tests** ✅ DONE (iteration 1)
  `packages/happy-agent/src/api/rpc/registerHandlers.test.ts`. Drives the
  registered handler lambdas through a fake RpcHandlerManager and asserts the
  `checkBlockedBashCommand` / `validatePath` wiring per handler (bash, readFile,
  writeFile, listDirectory, getDirectoryTree) — catches a handler that forgets
  to call a policy, which policy unit tests cannot. Complements ADR-0049.

- **A2 — App: tests for untested critical sync logic** ✅ DONE (iteration 1)
  New `sources/sync/syncHelpers.test.ts` (13 tests — `textNeedsAttention`
  heuristics + `detectNeedsAttention` priority ladder; storage mocked to keep
  the test a leaf) and `sources/sync/sessionForkFlow.test.ts` (9 tests — the
  fork RPC → spawn state machine incl. the directory-approval retry
  sub-machine, `@/sync/ops` mocked). NOTE: `sessionMessageProcessor` was
  claimed untested but `sessionMessageProcessor.test.ts` already exists — moot.

- **A3 — Server: knowledge turn-budget pure functions** ✅ ALREADY COVERED
  `sources/modules/knowledgeAccess.spec.ts` (220 lines) already tests
  `getInitialTurnBudget`, `decideReinjectAction`, and `computeTurnHitPlan`
  exhaustively (fallbacks, cap, mixed batches, simulations). The server Explore
  agent's "no covering tests found" was wrong (searched `.test.ts`, missed
  `.spec.ts`). No work needed. Do NOT add the "BudgetCalculator class" the raw
  candidate suggested — codebase is functional; it would be a shallow wrapper.

## Tier B — genuine structural deepening (verify duplication first)

- **B1 — Server: knowledge intake seam**
  `knowledgeConsolidate.ts` + `knowledgeWrite.ts` + `knowledgeAccess.ts`. IF the
  consolidate → write → record-access spine is truly duplicated across ≥2 call
  sites (REST route, socket handler, contributor), extract an
  `intakeKnowledgeEntry(...)` seam — parallels the established **Task intake** /
  **Artifact intake** seams in CONTEXT.md, so it fits the codebase pattern.
  Verify the duplication is real (not surface) before extracting.

- **B2 — CLI: AcpBackend deepening**
  Fold the shallow `sessionUpdateHandlers.ts` (wide 9-field `HandlerContext`,
  trivial util wrappers) into `AcpBackend`, and consolidate the four tool-call
  tracking maps into one owner (functional module, not a class). Verify
  shallowness first; stays local per ADR-0005.

## Tier C — rejected (conflicts settled ADRs / premature abstraction)

Record as ADRs only if a future review keeps re-suggesting them.

- App "API factory" over 20 `api*.ts` modules — premature; thin modules are
  intentional (cf. ADR-0070). The Zod-per-module shape is the value.
- App "data-hook factory" over `useSessionKnowledge/useProjectKnowledge/
  useInboxData` — **directly contradicts ADR-0062 (amended by 0068)**, which
  already ruled these hooks do NOT share a fetch seam.
- App "message lifecycle coordinator" merging reducer.ts (1945 lines) + fold +
  ordering — very high risk to the app's core; touches ADR-0032/0039 turf.
- App "per-session state factory" — `sessionScopedStore` already is the generic
  one; the other two have different shapes. Premature.
- CLI "extract RpcHandlerManager to shared package" — **contradicts ADR-0035**
  (duplicated-until-drift, guarded by a parity test). Not drifted → keep.
- CLI "unify OCC across cli/agent" — needs a new shared published package for a
  benefit that is currently zero; same duplicated-until-drift philosophy.
- CLI "SessionLifecyclePolicy" over Guardian + TrackedSessions — forces two
  registries with different keys/lifespans behind one interface = premature.
- Server "socket handler sweep through registerSocketEvent" — ADR-0044 is
  already the seam; large mechanical sweep, low marginal value.
- Server "DeferredBatchWriter<T> generic" — one class already handles session +
  machine fine; extract when a third entity appears.
- Server "ApiResponseBuilder class" — class anti-pattern here; ADR-0034 already
  sets the ops-error convention.

## Progress log
- 2026-07-05 iter 1: **Tier A complete.** A1 done (10 tests), A2 done (22 tests:
  syncHelpers 13 + sessionForkFlow 9), A3 already covered (no work). Agent full
  suite 343/343 green; new app leaf tests green. Only new test files added — no
  source changed. Next: Tier B (B1 knowledge intake seam → verify duplication
  first; B2 AcpBackend deepening → verify shallowness first). Both are
  structural refactors; verify before extracting per codebase philosophy.
