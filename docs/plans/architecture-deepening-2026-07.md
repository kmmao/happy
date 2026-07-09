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

- **B1 — Server: knowledge intake seam** ✅ RESOLVED (iteration 2)
  Verification REJECTED the proposed `intakeKnowledgeEntry(...)` seam as
  premature. The "consolidate → write → record-access spine" conflates two
  *separate* flows: (a) the **write/intake** flow `consolidate → writeKnowledgeEntry`
  (4 sites: REST POST, socket submit, machineUpdateHandler, contributor) whose
  invariant `create→supersede→embed` is **already extracted** as
  `writeKnowledgeEntry` (its doc comment is the documented owner); and (b) the
  **read/inject** flow `fetch → recordKnowledgeAccess` (2 sites: REST inject,
  socket fetch) whose access accounting also already lives in `knowledgeAccess.ts`.
  Both flows diverge materially per path (REST=inbox+refine-all+semantic-inject;
  socket=world-event+count+refine-skip-repo_map+keyword-rank via
  `rankKnowledgeByContextHints`; contributor=embed-only, no config check). Wrapping
  them would be a shallow options-bag over divergent orchestration — the exact
  anti-pattern `writeKnowledgeEntry`'s doc comment and CONTEXT.md forbid.
  **Real drift found & fixed instead:** `knowledgeContributor.ts` was *inlining*
  its own create→supersede→embed block, bypassing the documented single owner.
  Routed it through `writeKnowledgeEntry` (dropped inline `inTx`/`supersedeEntry`/
  `storeKnowledgeEmbedding`). Typecheck clean; knowledgeContributor + knowledgeWrite
  specs green (6/6).

- **B2 — CLI: AcpBackend deepening** ✅ DONE (iteration 3)
  Verification REJECTED "fold `sessionUpdateHandlers.ts` into `AcpBackend`":
  the module is **559 lines of real lifecycle logic** (tool-call state machine,
  timeout scheduling, investigation-tool detection, error extraction), explicitly
  extracted *for* testability — folding it back reverses a deepening and bloats
  the 1333-line class to ~1900. The `HandlerContext` DI shape is the seam, not a
  smell. The "consolidate 4 tool-call maps into one owner" sub-part IS a genuine
  latent invariant (the 4 maps share an identical keyset and always co-mutate),
  but it had **zero tests**. Added `sessionUpdateHandlers.test.ts` (25
  characterization tests) that lock the co-mutation invariant + emitted messages
  — pure-upside test surface (like Tier A) and the safety net for the map merge.
  **Remaining next step (now safe under green):** collapse the 4 maps. NOTE the
  blast radius — `activeToolCalls` is NOT purely internal; it is exposed via
  `TransportHandler`'s `PromptContext.activeToolCalls`, so a full merge ripples
  into the transport contract + implementations. A contained alternative:
  merge only the 3 internal maps (`toolCallStartTimes` + `toolCallTimeouts` +
  `toolCallIdToNameMap`) into one `Map<id, ToolCallState>` and keep
  `activeToolCalls` as the exposed Set. Do this deliberately next iteration.
  **Iteration 3 completed the contained merge:** the 3 internal maps are now
  one `Map<string, ToolCallState>` (`{ name, startTime, timeout? }`) in
  `sessionUpdateHandlers.ts` (`HandlerContext.toolCalls`) + `AcpBackend.ts`
  (field, `createHandlerContext`, `dispose`). `activeToolCalls` untouched (still
  the transport-contract Set). The 25 characterization tests were updated for
  the new shape and stay green; build typecheck clean. Zero remaining references
  to the old map names. **Tier B is now fully done.**

- **B3 — CLI: spawn-and-collect seam** DONE (iteration 5)
  Surfaced by a fresh convergence scan (iter 5) — the first genuinely new
  groundable candidate since iter 1. Verified against live code (not the scan's
  framing): three sites ran a character-identical subprocess lifecycle —
  `packages/happy-cli/src/modules/difftastic/index.ts` `run`,
  `.../modules/ripgrep/index.ts` `run`, and `.../utils/tmux.ts` `runCommand`
  (private). All three: `new Promise` -> `spawn` -> accumulate `stdout`/`stderr`
  on `'data'` -> `close` resolves `{ exitCode: code || 0, stdout, stderr }` ->
  `error` rejects. The only variation was pure input to `spawn` (command, args,
  spawn options: difftastic's `FORCE_COLOR` env, ripgrep's node launcher, tmux's
  `stdio:['ignore',..]`/`timeout`/`shell` + spread `...options`). This is the
  OPPOSITE of the B1 rejection: B1's flows had divergent orchestration (an
  options-bag would have hidden real branching); here the orchestration is
  identical and only the config differs -> a real "two/three adapters = real
  seam" extraction the codebase philosophy endorses. Deletion test passes: remove
  the seam and the same accumulate-and-resolve lifecycle reappears in all three
  callers. Implemented: new `src/utils/spawnAndCollect.ts` owning the invariant
  (`spawnAndCollect(command, args, options?: SpawnOptions)`), doc comment naming
  it the single owner so future subprocess wrappers route through it instead of
  copy-pasting. All three callers now delegate; the now-unused `spawn` import
  dropped from difftastic/ripgrep and from tmux (kept `SpawnOptions`). Added
  `src/utils/spawnAndCollect.test.ts` (5 deterministic `node -e` characterization
  tests: stdout capture, stderr isolation, non-zero exit, multi-chunk
  accumulation, spawn-error rejection). Verified: package typecheck clean; seam 5
  + difftastic 5 + ripgrep 5 + tmux 54 = 69 tests green; behavior preserved
  (delegation is exact — `code || 0` kept verbatim).

- **B4 — Agent: machine OCC update seam** DONE (iteration 16)
  Surfaced by the iter-16 fresh scan (triggered by real drift — 14 new user
  commits landed since iter 5, tree clean, prior convergence invalidated).
  `packages/happy-agent/src/api/machineClient.ts` had two character-identical OCC
  methods — `updateMachineMetadata` and `updateDaemonState`. Both: wrap
  `withBackoff({maxRetries:3})` → run the caller's handler over the current field
  value → `socket.emit(event, {machineId, [field]:encrypt(...), expectedVersion})`
  → on `result==="success"` adopt `decrypt(answer[field])` + `answer.version`;
  on `result==="version-mismatch"` adopt version + decrypted value then `throw`
  to trigger a backoff retry. The ONLY variation was the field name
  (`metadata`/`daemonState`), its `${field}Version` companion, the socket event
  name (`machine-update-metadata`/`machine-update-state`), the retry label, and
  the mismatch-error text — all pure config, identical orchestration. This is a
  real 2-adapter seam (opposite of the B1/server-pair rejections, whose wrappers
  had divergent orchestration). NOTE: this is **within happy-agent only** — NOT
  the ADR-rejected cli↔agent OCC unify (the CLI's `versionedUpdate.ts` is a
  separate package the agent cannot import; the "no agent-side duplicate" note in
  Tier C referred to cross-package, but two copies existed inside the agent).
  Implemented: extracted a private generic `runVersionedFieldUpdate<T>(field,
  eventName, handler, label, mismatchError)` owning the lifecycle; both public
  methods are now thin field-specific adapters. Behavior preserved exactly
  (mismatch-error strings + labels passed through verbatim). Verified: agent
  build + `tsc --noEmit` clean; full suite 343/343 green.

## Tier C — rejected (conflicts settled ADRs / premature abstraction)

Record as ADRs only if a future review keeps re-suggesting them. Each item is
annotated below with its ADR-coverage status (audit — iter 4). Legend: ✅ covered
= a dedicated ADR already/now settles it; ⚠️ stale = the described code no longer
exists in that shape (re-ground against live code before ADR-ing IF re-suggested).

- App "API factory" over 20 `api*.ts` modules — premature; thin modules are
  intentional (cf. ADR-0070). The Zod-per-module shape is the value.
  *(groundable; no dedicated ADR yet — write only if re-suggested.)*
- App "data-hook factory" over `useSessionKnowledge/useProjectKnowledge/
  useInboxData` — **directly contradicts ADR-0062 (amended by 0068)**, which
  already ruled these hooks do NOT share a fetch seam. ✅ covered (ADR-0062/0068).
- App "message lifecycle coordinator" merging reducer.ts (1945 lines) + fold +
  ordering — very high risk to the app's core; touches ADR-0032/0039 turf.
  *(groundable; no dedicated ADR yet — write only if re-suggested.)*
- App "per-session state factory" — `sessionScopedStore` already is the generic
  one; the other two have different shapes. Premature.
  *(groundable; no dedicated ADR yet — write only if re-suggested.)*
- CLI "extract RpcHandlerManager to shared package" — **contradicts ADR-0035**
  (duplicated-until-drift, guarded by a parity test). Not drifted → keep.
  ✅ covered (ADR-0035; cf. ADR-0063 for the same family, TunnelManager).
- CLI "unify OCC across cli/agent" — needs a new shared published package for a
  benefit that is currently zero; same duplicated-until-drift philosophy.
  ⚠️ **stale**: iter-4 audit found only ONE OCC copy today
  (`packages/happy-cli/src/api/versionedUpdate.ts` — the extracted invariant
  owner `runVersionedUpdate`); no agent-side duplicate exists, so there is
  nothing to "unify". Moot unless the agent grows its own copy.
- CLI "SessionLifecyclePolicy" over Guardian + TrackedSessions — forces two
  registries with different keys/lifespans behind one interface = premature.
  ✅ covered — **ADR-0074 (iter 4)**: `GuardianSessionRegistry`
  (continuity keys `loop:`/`project:trigger:agent` → reusable sessionId) and
  `TrackedSessionRegistry` (process keys `spawn:`/`sess:` → full process record
  w/ pid/heartbeat/activity + crash recovery) are two domains, not one invariant.
- Server "socket handler sweep through registerSocketEvent" — ADR-0044 is
  already the seam; large mechanical sweep, low marginal value. ✅ covered (ADR-0044).
- Server "DeferredBatchWriter<T> generic" — one class already handles session +
  machine fine; extract when a third entity appears.
  ⚠️ **stale**: iter-4 audit found no `DeferredBatchWriter`/`BatchWriter` class
  in `packages/happy-server/sources` by that name. Re-ground against the actual
  batched-write mechanism before ADR-ing IF a future review re-surfaces it.
- Server "ApiResponseBuilder class" — class anti-pattern here; ADR-0034 already
  sets the ops-error convention. ✅ covered in spirit (ADR-0034 sets the convention).
- Server "unify sessionVersionedFieldUpdate + machineVersionedUpdate into one
  generic `genericVersionedFieldUpdate<Entity>`" — **rejected iter 16**. Both
  already delegate to the shared `versionedUpdate` seam; the remaining wrappers
  diverge per entity in load-bearing ways: session has 3 fields + returns void +
  acks `error` silently, machine has 2 fields + the daemonState write also flips
  `active`/`lastActiveAt` + the method RETURNS the CAS outcome so the caller runs
  brief detection only on apply + acks `error` with a message. Merging = a
  param-heavy options-bag over two DB tables with different post-success
  contracts (same class as the B1 rejection — shared spine already extracted,
  wrappers legitimately diverge). *(groundable; no dedicated ADR yet — write only
  if re-suggested.)*
- CLI/App "extract `buildIssuePrompt` + its 5 helpers (formatDate/truncate/
  extractImageUrls/buildCommentsSection/buildPrCreateStep) to a shared owner" —
  **surfaced + rejected iter 16 (first suggestion).** The 6-function block is
  near-duplicated across `packages/happy-cli/src/webhook/buildIssuePrompt.ts` and
  `packages/happy-app/sources/utils/launchIssueSession.ts`, and a comment in
  `IssueSummaryHeader.tsx` ("matching CLI buildIssuePrompt format") flags the
  coupling. BUT the copies have already **drifted** — App's `buildPrCreateStep`
  takes a 3rd `repoInfo` arg the CLI version lacks — i.e. genuine per-platform
  divergence, not one invariant. And the packages intentionally cannot import
  each other (cli ↔ app); the only shared runtime home is `happy-wire`, whose
  narrow purpose is message wire types + Zod schemas, NOT a GitHub-issue prompt
  builder. Matches the codebase's deliberate cross-package "duplicated-until-drift"
  tolerance (ADR-0035 RpcHandlerManager, ADR-0063 TunnelManager, tailscale.ts).
  *(groundable; per plan rule, ADR only if a FUTURE review re-suggests it — this
  is the first, so logged here not ADR'd.)*

## Progress log
- 2026-07-05 iter 1: **Tier A complete.** A1 done (10 tests), A2 done (22 tests:
  syncHelpers 13 + sessionForkFlow 9), A3 already covered (no work). Agent full
  suite 343/343 green; new app leaf tests green. Only new test files added — no
  source changed. Next: Tier B (B1 knowledge intake seam → verify duplication
  first; B2 AcpBackend deepening → verify shallowness first). Both are
  structural refactors; verify before extracting per codebase philosophy.
- 2026-07-06 iter 2: **Tier B verified.** B1: proposed `intakeKnowledgeEntry`
  seam rejected as premature (invariant already extracted as `writeKnowledgeEntry`;
  write vs inject flows genuinely diverge). Real drift fixed instead —
  `knowledgeContributor.ts` routed through the documented owner
  `writeKnowledgeEntry` (server typecheck clean; contributor+write specs 6/6).
  B2: "fold sessionUpdateHandlers into AcpBackend" rejected (559-line real module,
  extracted for testability). Added `sessionUpdateHandlers.test.ts` (25
  characterization tests, green) locking the 4-map co-mutation invariant. Map
  consolidation deferred: `activeToolCalls` is in the `TransportHandler` contract,
  so full merge has cross-cutting blast radius — do the contained 3-internal-map
  merge next, now safe under the new tests.
- 2026-07-06 iter 4: **Tier C audit + first rejection ADR.** All dev-work was
  already done (Tier A+B). Audited the 10 Tier C rejections for ADR coverage:
  3 already covered (data-hook factory → 0062/0068; RpcHandlerManager → 0035;
  socket sweep → 0044; ApiResponseBuilder in spirit → 0034); 2 stale (OCC-unify
  — only one copy `versionedUpdate.ts` exists, no agent duplicate; DeferredBatchWriter
  — no such class in server today); the rest groundable but no dedicated ADR yet.
  Wrote **ADR-0074** for the one re-suggestion trap I could ground precisely from
  verbatim code — Guardian vs TrackedSession registries stay separate (different
  keys/shapes/lifespans, not one `SessionLifecyclePolicy`). Annotated the Tier C
  list with per-item coverage status. No source changed; docs only. Remaining
  optional backlog: dedicated ADRs for the 3 "groundable, uncovered" App items —
  write ONLY if a future review re-suggests them (avoid pre-emptive imprecise ADRs).
- 2026-07-06 iter 3: **Tier B complete (B2 finished).** Merged the 3 internal
  tool-call maps (`toolCallStartTimes` + `toolCallTimeouts` + `toolCallIdToNameMap`)
  into one `Map<string, ToolCallState>` across `sessionUpdateHandlers.ts` +
  `AcpBackend.ts`, keeping `activeToolCalls` as the exposed transport-contract Set.
  Preserved exact lifecycle semantics (name/startTime refresh + timeout guard).
  Updated the 25 characterization tests to the new shape — all green; build
  typecheck clean; no stale references. **All actionable recommendations (Tier A +
  Tier B) are now implemented. Tier C stays rejected (implement only as ADRs if
  a future review keeps re-suggesting them).** Mission dev-work complete.
- 2026-07-09 iter 16: **Drift detected → fresh scan → B4 built + 2 rejections.**
  Iters 6–15 stayed converged (HEAD pinned `42c811f3b`). Iter 16's cheap git
  staleness check found HEAD had moved to `886e2297c` — 14 new user commits since
  iter 5 (incl. the user committing all prior iter-2–5 arch work, plus fresh arch
  refactors: env/bash-policy seams, server versionedUpdate for prefs+account,
  app machine-op/duration consolidation, sub-agent reaping). Prior convergence
  invalidated → re-ran the full `/improve-codebase-architecture` fan-out (3
  Explore agents: cli/agent, server, app). Verified every candidate verbatim.
  Result: ONE cleared the strict bar — **B4** (agent machine OCC seam, above);
  built + verified (343/343 green). THREE rejected after verbatim reads:
  (a) server session/machineVersionedUpdate unify (divergent per-entity wrappers
  over a shared seam — Tier C); (b) server 10-min staleness constant (codebase
  keeps duration magic numbers inline-with-comment by convention — not worth a
  precedent); (c) CLI/App buildIssuePrompt cross-package dup (already drifting;
  wire is the wrong home; duplicated-until-drift — Tier C, logged not ADR'd per
  first-suggestion rule). Converged again.
- 2026-07-06 iter 5: **Fresh convergence scan + B3 built.** Re-ran the review's
  Explore step against the current (iter 1–4-changed) code to genuinely check for
  new work rather than assume convergence. Result: exactly ONE new groundable
  candidate cleared the strict anti-premature-abstraction bar — a duplicated
  spawn-and-collect subprocess lifecycle across difftastic/ripgrep/tmux (three
  character-identical adapters; only spawn config varies). Verified against live
  code, confirmed it is a real 2/3-adapter seam (opposite of the B1 rejection),
  and built it: `src/utils/spawnAndCollect.ts` + 5 tests; routed all three callers
  through it; dropped unused `spawn` imports. Typecheck clean; 69 affected tests
  green (seam 5 + difftastic 5 + ripgrep 5 + tmux 54). Everything else in the scan
  re-surfaced only already-rejected/already-done items → **converged.** No further
  groundable dev-work exists; future runs should STOP unless a new review surfaces
  a fresh groundable candidate.
