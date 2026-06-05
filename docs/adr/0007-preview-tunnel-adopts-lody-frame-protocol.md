---
status: accepted
---

# Preview tunnel and VisualAnnotation reach parity with lody.ai for in-project frontend development

**Goal.** An Account using Happy can do everything an Account using lody.ai can do for live preview and visual annotation of a Machine-side dev server — without leaving the project, on any client network. Every sub-decision below serves this goal; departures from lody's implementation are justified only when they preserve the experience while fitting Happy's stack.

Per CONTEXT.md, a **Preview** consists of a **PreviewCandidate** (reported by the Agent via `report_preview`) and an optional **PreviewTunnel** (active proxy connection); a **VisualAnnotation** is a UI feedback action within a Preview that produces a **SessionMessage**. Today the PreviewTunnel flows `App → Server (HTTP gateway at /preview/{tunnelId}) → Daemon (Socket.IO) → localhost:port` with HTTP-only proxy frames, response bodies base64-encoded, no WebSocket transparency, no application-layer backpressure, no per-tunnel resource accounting. CONTEXT.md line 68 nonetheless asserts "Includes WebSocket proxying for HMR" — a doc-vs-code drift this ADR resolves by fixing the code. VisualAnnotation travels as markdown SessionMessage with a fenced JSON block (`visual-annotation`), explicitly tagged in CONTEXT.md line 148 as a drift from lody's structured `visual_annotation_reference` inputBlock.

lody is a peer system Happy already tracks (CONTEXT.md line 148). lody-0.56.0's CLI bundle (`~/Downloads/lody-0.56.0-package/dist/index.js`) ships the parity baseline: dedicated reverse WebSocket per tunnel, full HTTP + WebSocket frame family, binary-payload double-frames, credit-based backpressure, per-tunnel resource limits, `viewerScope: workspace` shared access, and structured `visual_annotation_reference` inputBlocks. We have read the bundle and decide below what to adopt as-is, what to adapt to Happy's stack, and what to defer.

## Acceptance criteria

The decisions below are accepted iff, after implementation, all of these hold:

1. The App previews a Daemon-side dev server **from any network** — no Tailnet membership, no LAN-only requirement, no client-side port forwarding.
2. **HMR works.** Vite / Next / Expo dev WebSockets are transparently proxied; saving a file in the previewed project does not tear down the previewed page.
3. **VisualAnnotations are structured.** The Account clicks an element in the previewed page, writes a comment, and the Session receives a typed message carrying selector + xpath + ancestor chain + computed style — not a free-form markdown blob the Agent has to parse.
4. **Annotation pins stay anchored** across DOM mutations (existing AnnotationPinsOverlay + ANCHOR_UPDATE protocol persists, now driven by the structured channel).
5. From the App's perspective, the previewed page renders with the same fidelity as a lody preview — same iframe behavior, same CSP/X-Frame stripping, same Set-Cookie stripping, same cross-origin posture.
6. The URL displayed in the App's PreviewToolbar reads as the **target form** (`http://localhost:{target.port}{target.path}`), matching what an Account sees in lody. The iframe's actual `src` continues to flow through the PreviewTunnel; URL display and traffic transport are decoupled. This is a UI cosmetic, not a network capability — lody enforces loopback on the PreviewTarget (`isLoopbackHost` in `dist/index.js:141435`) and renders that loopback form unchanged in its toolbar even though iframe traffic flows through the public tunnel. Happy adopts the same pattern.

The four faces below — **protocol**, **public URL**, **viewer scope**, **annotation channel** — are independent owners of these criteria. They are decided separately so each can ship on its own clock without re-litigating the others.

## Decision — protocol face: adopt lody's frame shapes on our existing Socket.IO transport

The PreviewTunnel frame family in `@kmmao/happy-wire` becomes:

- `request-start` / `request-body` / `request-end` / `request-cancel`
- `response-start` / `response-body` / `response-error`
- `websocket-connect` / `websocket-frame` / `websocket-close` / `websocket-reject`
- `binary-payload` — a JSON header naming `{stream, requestId}` followed by a single raw binary message on the same socket; eliminates base64's ~33% inflation on response bodies
- `response-body-credit` — application-layer backpressure: the receiver returns credit, the sender blocks when exhausted
- `tunnel-ready` / `client-ready` / `tunnel-accepted` — capability + `PREVIEW_TUNNEL_PROTOCOL_VERSION` handshake; clients announce what they support, server announces what it accepts, mismatch produces an `error` frame and a clean fall back to `idle`

The schemas live in `@kmmao/happy-wire`; `previewGateway.ts` on the Server and the Daemon-side proxy in `happy-cli` consume them. We keep the existing transport — Socket.IO room from Daemon to Server, Fastify HTTP from Server to App — rather than open a second WebSocket. lody opens a dedicated reverse WebSocket (`tunnel.websocketUrl`) per tunnel; we don't, because the Daemon already maintains an authenticated Socket.IO connection for every Machine and adding a per-tunnel WebSocket would duplicate auth, reconnect, and lease-refresh code with no observable difference to the Account (criterion 5 cares about the rendered page, not the transport).

WebSocket transparency — the `websocket-*` frames — is what unlocks acceptance criterion 2. The header-exclusion lists (hop-by-hop + WS-only + response set-cookie/cookie, plus forced `accept-encoding: identity` toward the local dev server) and the path-safety checks (`assertRelativeTunnelPath` + `assertBoundLocalUrl` rejecting `..`, control chars, absolute URLs, and SSRF outside the bound local origin) come along with the protocol decision; lody's lists are more complete than ours and the substitution is mechanical.

The annotation runtime injection (lody's `data-lody-visual-annotation-runtime` marker → ours becomes `data-happy-visual-annotation-runtime`) rides on the response-body pipeline of this same protocol: the gateway injects a script tag into HTML responses, the injected script postMessages selector/xpath/computed-style back to the App. The injection point is the `response-start`/`response-body` pair on the protocol above — it does not need its own face.

## Decision — public URL face: phased

**Phase 1 (this ADR):** keep the path-prefix URL `/preview/{tunnelId}/{path}` on Caddy. This unblocks acceptance criteria 1–4 without any DNS or certificate work; the App's iframe loads the URL same-origin with the Server, the existing CSP / X-Frame-Options stripping (`previewGateway.ts:143-147`) keeps embedding viable, and tunnelId's ~62 bits of entropy carry authentication (CONTEXT.md line 145 already endorses this profile). Criterion 5 is satisfied here too unless one of the phase-2 triggers below fires on a specific previewed page; criterion 6 is satisfied independently by the Display URL paragraph and is invariant across phases.

**Phase 2 (separate ADR):** per-tunnel subdomain `{tunnelId}.preview.{host}` when criterion 5 demands it. Triggers that move us to phase 2: a previewed page sets cookies that collide with Server auth cookies on `/`; a CSP framework the path-prefix URL cannot work around; a third-party SDK in the previewed page that hard-checks `window.location.origin`. Phase 2 is not gated on phase 1's wire contract — the phase-1 wire is forward-compatible.

**Display URL (both phases — App cosmetic):** the App's PreviewToolbar URL bar shows the target form `http://localhost:{target.port}{target.path}` — exactly what an Account sees in lody — while `LivePreviewView`'s iframe `src` uses the transport URL (`/preview/{tunnelId}/{path}` in phase 1, `{tunnelId}.preview.{host}/{path}` in phase 2). When the Account edits the URL bar, the App parses the entered URL, extracts the path portion, and applies it to the iframe `src`; the host/port portion stays decorative and only mutates if the Account picks a different target from the dev-server list. This decoupling is a pure App-side decision and rides on no protocol-face change — it satisfies criterion 6 without touching `@kmmao/happy-wire` or the gateway.

## Decision — viewer scope face: session-scoped today, `viewerScope` field reserved in wire for future Workspace

The wire shape for `PreviewConnectionSchema` gains a `viewerScope` discriminated union with a forward-compatible variant set:

```
viewerScope: { type: "session" }                                  // current; the only value Server accepts
            | { type: "account-friends", grantedTo: string[] }    // reserved
            | { type: "workspace", workspaceId: string }          // reserved
```

Server today only accepts `{ type: "session" }`; any other value produces an `error` frame on `tunnel-ready`. We reserve the union shape so a future ADR introducing team workspaces (Happy intends to add this — it is a documented future direction, not a hypothetical) does not need to break the wire contract again; that future ADR ships server enforcement of the new variants and matching App UI without `@kmmao/happy-wire` having to re-major.

This is **schema-level forward compatibility**, not a domain-model decision: Happy still has no Workspace entity. Introducing a Workspace as a first-class domain term — owning Sessions, Machines, Projects — would touch CONTEXT.md's full relationship graph, every Prisma table, the E2E encryption scope model (ADR-0001), and the App's navigation; that is a separate, larger ADR. By reserving only the wire shape here, ADR-0007 stays focused on parity and does not block on a Workspace domain decision.

## Decision — annotation channel face: adopt lody's `visual_annotation_reference` inputBlock as the canonical channel

The Account-side flow stays the same — click element, write comment, AnnotationPinsOverlay tracks the pin. The transport changes: instead of constructing a markdown SessionMessage with an embedded fenced JSON block, the App submits a typed `visual_annotation_reference` inputBlock carrying selector + xpath + ancestor chain + computed style + comment, and the Daemon forwards it through the session protocol as a first-class field. The Agent receives it as structured data — no markdown parsing, no fenced-block extraction.

Back-compat: the markdown form continues to work for one minor version. CLI / Agent paths that read SessionMessage content keep their fenced-block parser; the App marks new submissions with an inputBlock flag; the Server tolerates both during the transition and drops the markdown path after the App's next-but-one release (equivalently: one minor version of `@kmmao/happy-wire` after the inputBlock-enabled major — the two clocks describe the same drop event from App and wire angles respectively). CONTEXT.md line 148's drift marker is removed once both ends are on the inputBlock path.

## Consistency with other ADRs

- **ADR-0006 (preview state in-memory only)** stands. We upgrade the wire and the proxy loop, not the storage model — candidates and tunnels remain in-memory `Map`s on the Server.
- **ADR-0001 (E2E encryption zero-knowledge server)** is reaffirmed and clarified. Preview traffic is **not** E2E-encrypted (the browser must receive valid HTTP); CONTEXT.md line 147 already surfaces this. Binary payloads remove base64 inflation but do not change which party sees plaintext page content — the Server still does. The annotation channel does not weaken E2E either: the inputBlock travels as part of the encrypted SessionMessage envelope, same key model as today's markdown SessionMessage.
- **ADR-0004 (encryption scope readiness seam)** is unrelated — Preview state has its own readiness lifecycle (`reported → available → invalid` on the candidate, `idle → creating → active → failed/revoked/expired` on the tunnel) and is never decrypted by `resolveSessionEncryption`.

## Implementation notes (lody reference, with line numbers)

Sourced from `lody-0.56.0/dist/index.js`. Constants are evidence, not prescription — we adopt the *shape*, pick our own thresholds.

- Frame family + binary-payload double-frame handling: lines 140649–140737 (`handleServerMessage`, `handleBinaryPayload`)
- Header exclusion sets (hop-by-hop, WS-only, response): lines 140262–140295
- Path safety (`assertRelativeTunnelPath`, `assertBoundLocalUrl`): lines 140414–140423
- Tunnel create response schema (`tunnelId / publicUrl / websocketUrl / sessionToken / expiresAt / resourceLimits`): line 54541
- Tunnel lifecycle (`startPreviewTunnel`, refresh loop, exponential reconnect, revoke): lines 140424–140577
- Annotation runtime injection marker (`data-lody-visual-annotation-runtime`): line 140308
- Constants: HTTP body batch 32 KiB; ready timeout 15 s; session refresh 5 min; reconnect backoff 1 s → 30 s; backpressure 256 KiB high / 64 KiB low

lody's `package.json` declares MIT. Adopting frame *shapes* — a wire contract — does not import code; we reimplement against `@kmmao/happy-wire` with zod schemas. The annotation inputBlock name follows lody's identifier (`visual_annotation_reference`) so cross-system tooling speaks the same wire.

## Considered alternatives

- **Fully introduce a Workspace domain concept in this ADR.** Rejected as out-of-scope. A Workspace entity owning Sessions / Machines / Projects touches CONTEXT.md's full relationship graph, every Prisma table, the E2E encryption scope model (ADR-0001), and App navigation. That decision deserves its own ADR; reserving the wire shape here is enough to keep that future ADR from re-majoring `@kmmao/happy-wire`.
- **Adopt phase-2 subdomains immediately.** Rejected: pays no acceptance criterion that the path-prefix URL doesn't already pay, and gates protocol + annotation work on Caddy wildcard cert / DNS decisions.
- **Open a per-tunnel reverse WebSocket like lody, instead of multiplexing on Daemon Socket.IO.** Rejected: the Daemon's authenticated Socket.IO is already up and reconnect-tested; a second WebSocket per tunnel duplicates auth + lease refresh + connection lifecycle with no Account-visible difference. lody's separate `websocketUrl` makes sense for them because their Daemon does not pre-maintain an authenticated per-Machine channel; ours does.
- **Wire-compatible fork of lody's gateway.** Rejected: lody runs on Cloudflare Workers + Convex + Loro CRDT; we run on Fastify + Postgres + Socket.IO. `PreviewTunnelCreateResponse` is portable; the gateway implementation is not.
- **Keep the markdown fenced-JSON annotation channel; only upgrade the tunnel protocol.** Rejected: criterion 3 ("annotations are structured") fails. The Agent currently has to parse a fenced block out of a markdown SessionMessage; that path is fragile and CONTEXT.md line 148 already flags it. Fix it while the wire is changing anyway.
- **Do nothing, accept the current HTTP-only proxy.** Rejected: criteria 1 (any-network), 2 (HMR), 3 (structured), 5 (parity), 6 (target-form URL display — today the App shows the Tailscale-direct or Caddy URL, not `http://localhost:{port}`) all fail.

## Consequences

- `@kmmao/happy-wire` ships a major version that adds the new frame family, the `viewerScope` reserved union, and the `visual_annotation_reference` inputBlock. Publish order is wire → CLI/Agent → server → app (per CLAUDE.md monorepo rules). Old clients see `error` on `tunnel-ready` capability mismatch and fall back cleanly to `idle` — no silent data corruption.
- WebSocket proxying lands. Dev-server HMR works through a PreviewTunnel; CONTEXT.md line 68 stops being aspirational. The same `websocket-*` frames cover dev-server-initiated WebSockets (Vite client → HMR server) and app-initiated WebSockets the previewed page may open.
- Response bodies stop being base64-encoded; expect lower latency and lower bandwidth on iframe loads. Application-level credits cap per-request memory usage on the Server and bound the worst-case per-tunnel footprint.
- `usePreviewTunnel.ts` gets a `capabilities` array returned by the gateway; the App feature-flags off it (binary payloads, WS frames, inputBlock annotations) so newer clients negotiate while older clients fall back.
- Happy-app's AnnotationCommentSheet / AnnotationPinsOverlay submission path switches to the inputBlock channel. CONTEXT.md line 148's drift marker stops being a drift and becomes an implemented decision (the line is removed in the same commit that flips the App to inputBlock).
- Daemon-side PTY injection grows an inputBlock pathway alongside markdown injection; markdown injection persists as deprecated back-compat for one minor version, then drops.
- The App's PreviewToolbar URL value and the iframe `src` are now derived from independent sources — target form vs tunnel form. Two unit tests pin the contract: `urlBarDisplay(target)` returns `http://localhost:{target.port}{target.path}` regardless of tunnel state, and `iframeSrc(tunnel, path)` returns the transport URL (path-prefix or subdomain). PreviewToolbar's edit handler extracts the path from a user-entered URL before forwarding to `LivePreviewView`; the host/port portion of the input is parsed for selection only, never used to construct the iframe `src`.
- `viewerScope` is reserved in wire today but unused. A future Workspace ADR can extend `viewerScope` to `{ type: "workspace", workspaceId }` and ship server enforcement without re-majoring `@kmmao/happy-wire`. The four faces are now genuinely orthogonal — Workspace, subdomain URL, and any future protocol revision can each be its own ADR.
