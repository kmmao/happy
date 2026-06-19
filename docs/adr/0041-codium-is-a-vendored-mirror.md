---
status: accepted
---

# happy-codium is a vendored upstream mirror; internal architecture changes go upstream-first

## Context

`packages/happy-codium` was migrated wholesale from upstream `slopus/happy`'s
`packages/codium` and is **kept in sync with upstream by hand** — its CLAUDE.md documents the
workflow (`git diff upstream/main:packages/codium HEAD:packages/happy-codium`, manual merge)
and a deliberately *minimal* "known differences" table (package name, directory, package
manager, a native-rebuild hook, doc text). The intent is explicit: keep local divergence as
small as possible so each upstream pull is a clean diff/merge.

Architecture reviews keep surfacing real-looking friction inside codium's worker layer:

- **Worker-host duplication** (`boot/main/agent-worker/host.ts`, `boot/main/happy-worker/host.ts`):
  both spawn a `node:worker_threads` Worker and attach message/error/exit listeners. But their
  communication models genuinely differ — agent-host routes per-session push events to an
  owning renderer (`sessionOwners` map, `ipcMain.on` + per-session `wc.send`, crash → synthetic
  per-session error), while happy-host is request/response RPC (`pending` requestId map,
  `ipcMain.handle`, crash → reject-all-pending) plus a global state broadcast. The only shared
  part is the ~10-line spawn skeleton; a `WorkerHost` base would own that and leave every host
  overriding message/error/exit — a shallow seam.
- **Auth-state globals** (`boot/main/happy-worker/worker.ts`): `credentials` / `client` /
  `linkFlow` / `state` as loose module globals mutated from several flow functions (the
  parallel-state smell, cf. ADR-0037 in the App).
- **Chat-runner streaming buffers** (`app/chat/runner.ts`): per-message `MsgBuf` state with
  `flush()` reconstructed at many call sites and a hidden `streamed` seam.

## Decision

**Do not refactor happy-codium internals locally to deepen them.** Any architectural change to
codium's worker hosts, auth-state ownership, or chat-runner buffering should be made
**upstream-first** (in `slopus/happy`) and pulled down through the normal sync, so the local
package stays a thin, mergeable mirror. Local changes are limited to the documented divergence
set (packaging, build, native rebuild). For the worker-host case specifically, the unification
would also be shallow (the two hosts' comms models diverge), so it is not worth doing even
upstream without a third host to share the seam.

## Considered options

- *Extract a shared `WorkerHost<Req,Res>` base + `SessionRegistry` here.* Rejected twice over:
  the shared surface is a thin spawn wrapper (shallow), and it would fork codium's worker layer
  from upstream, turning every future upstream edit to those files into a merge conflict.
- *Introduce a `HappyAuthController` / `StreamingMessageAccumulator` here.* Rejected for the
  same sync-cost reason. These are legitimate deepenings — raise them upstream, where the whole
  codium ecosystem benefits and the mirror stays clean.

## Consequences

- A future architecture review that surfaces codium-internal friction should stop here: the
  fix belongs upstream, not in this mirror. Re-suggesting a local refactor reintroduces the
  merge-friction cost this ADR exists to avoid.
- If codium ever stops tracking upstream (a hard fork), revisit — at that point local
  refactors no longer carry the sync cost and the deepenings above become fair game.
