# API

This document covers the HTTP API surface and authentication flows. For WebSocket updates and event payloads, see `protocol.md`. For encryption boundaries and encoding details, see `encryption.md`.

## Method conventions
- **GET** is used for reads.
- **POST** is used for mutations or actions, even when the operation doesn't map cleanly to a single entity.
- **DELETE** is used when intent is unambiguous (e.g., removing a token or deleting a session/artifact).

We intentionally avoid the full REST verb palette because many operations span multiple entities or have non-CRUD semantics.

## Authentication
Most endpoints require `Authorization: Bearer <token>`.

Auth flows:
- `POST /v1/auth`
  - Body: `{ publicKey, challenge, signature }` (base64 strings)
  - Verifies signature using the provided public key.
  - Upserts account by public key and returns `{ success, token }`.

- `POST /v1/auth/request`
  - Body: `{ publicKey, supportsV2? }`
  - Creates or returns a terminal auth request.
  - Response: `{ state: "requested" }` or `{ state: "authorized", token, response }`.

- `GET /v1/auth/request/status?publicKey=...`
  - Response: `{ status: "not_found" | "pending" | "authorized", supportsV2 }`.

- `POST /v1/auth/response`
  - Body: `{ response, publicKey }` (requires Bearer auth)
  - Approves a terminal auth request.

- `POST /v1/auth/account/request`
  - Body: `{ publicKey }`
  - Similar to terminal auth, but for account linking.

- `POST /v1/auth/account/response`
  - Body: `{ response, publicKey }` (requires Bearer auth)

## Endpoint catalog
### Sessions
- `GET /v1/sessions`
- `GET /v2/sessions/active?limit=...`
- `GET /v2/sessions?cursor=cursor_v1_<id>&limit=...&changedSince=...`
- `POST /v1/sessions` (create or load by `tag`)
- `GET /v1/sessions/:sessionId/messages`
- `DELETE /v1/sessions/:sessionId`

### Machines
- `POST /v1/machines` (create or load by id)
- `GET /v1/machines`
- `GET /v1/machines/:id`

### Artifacts
- `GET /v1/artifacts`
- `GET /v1/artifacts/:id`
- `POST /v1/artifacts`
- `POST /v1/artifacts/:id` (versioned update)
- `DELETE /v1/artifacts/:id`

### Access keys
- `GET /v1/access-keys/:sessionId/:machineId`
- `POST /v1/access-keys/:sessionId/:machineId`
- `PUT /v1/access-keys/:sessionId/:machineId`

### Key-value store
- `GET /v1/kv/:key`
- `GET /v1/kv?prefix=...&limit=...`
- `POST /v1/kv/bulk`
- `POST /v1/kv` (batch mutate)

### Account and usage
- `GET /v1/account/profile`
- `GET /v1/account/settings`
- `POST /v1/account/settings`
- `POST /v1/usage/query`

### Push tokens
- `POST /v1/push-tokens`
- `DELETE /v1/push-tokens/:token`
- `GET /v1/push-tokens`

### Connect (GitHub + vendor tokens)
- `GET /v1/connect/github/params`
- `GET /v1/connect/github/callback`
- `POST /v1/connect/github/webhook`
- `DELETE /v1/connect/github`
- `POST /v1/connect/:vendor/register` (`vendor` in `openai | anthropic | gemini`)
- `GET /v1/connect/:vendor/token`
- `DELETE /v1/connect/:vendor`
- `GET /v1/connect/tokens`

### Users, friends, feed
- `GET /v1/user/:id`
- `GET /v1/user/search?query=...`
- `POST /v1/friends/add`
- `POST /v1/friends/remove`
- `GET /v1/friends`
- `GET /v1/feed`

### Version and voice
- `POST /v1/version`
- `POST /v1/voice/token`

### Projects
- `GET /v1/projects` — list projects. Query: `archived?` (boolean).
- `POST /v1/projects` — create project. Body: `{ machineId, path, repoUrl?, metadata? }`. Response: `{ project, created }`.
- `GET /v1/projects/:id` — get project by ID.
- `PATCH /v1/projects/:id` — update project. Body: `{ metadata?, repoUrl?, archived? }`.
- `DELETE /v1/projects/:id`
- `POST /v1/projects/resolve` — find-or-create by machine+path. Body: `{ machineId, path, repoUrl?, metadata? }`. Response: `{ project, created }`.
- `POST /v1/projects/:id/link-sessions` — bulk-link sessions. Body: `{ sessionIds }` (1–500). Response: `{ linked }`.
- `GET /v1/projects/:id/related` — list related projects (same repo across machines).

### Supervisor — runs
- `POST /v1/projects/:id/supervisor/run` — start a supervisor run. Body: `{ machineId?, repoPath?, trigger?, researchParams? }`. Trigger enum: `manual | research`.
- `GET /v1/projects/:id/supervisor/runs` — list runs. Query: `limit` (1–100, default 20), `offset`, `trigger?`.
- `GET /v1/projects/:id/supervisor/runs/:runId` — get single run.
- `POST /v1/projects/:id/supervisor/cancel/:runId` — cancel a running run.
- `POST /v1/projects/:id/supervisor/runs/:runId/status` — update run status (called by CLI agent). Body: `{ status, artifactId?, sessionId?, actionsCount?, issuesCreated?, errorMessage?, currentDimension?, dimensionIndex?, totalDimensions?, reportTitle?, reportContent?, actions? }`. Status enum: `running | completed | failed`.

### Supervisor — config
- `PATCH /v1/projects/:id/supervisor/config` — update supervisor settings. Body: `{ supervisorConfig?, supervisorMode?, supervisorScheduleEnabled?, supervisorScheduleIntervalHours?, supervisorEnabledDimensions?, supervisorPushTriggerEnabled?, supervisorNotifyPrefs?, supervisorCustomRules?, fixStrategy? }`. Response: `{ supervisorConfig, supervisorConfigVersion }`.

### Supervisor — actions
- `GET /v1/projects/:id/supervisor/actions` — list actions. Query: `approval?`, `view?`, `runId?`, `limit` (1–100, default 50), `offset`.
- `PATCH /v1/projects/:id/supervisor/actions/:actionId` — set approval. Body: `{ approval }`. Approval enum: `approved | skipped | ignored | pending`.
- `POST /v1/projects/:id/supervisor/actions/batch` — batch update approval. Body: `{ actionIds (1–50), approval }`.
- `DELETE /v1/projects/:id/supervisor/actions` — delete all actions for project.
- `DELETE /v1/projects/:id/supervisor/actions/:actionId` — delete single action.
- `GET /v1/projects/:id/supervisor/actions/stats` — action counts by status. Response: `{ pending, approved, skipped, ignored, approvedNoFix, fixPending, fixRunning, fixCompleted, fixFailed }`.
- `POST /v1/projects/:id/supervisor/actions/:actionId/fix` — trigger fix for action. Body: `{ machineId?, repoPath? }`.
- `PATCH /v1/projects/:id/supervisor/actions/:actionId/fix-status` — update fix status. Body: `{ fixStatus, fixSessionId?, issueUrl? }`. Status enum: `running | completed | failed`.
- `POST /v1/projects/:id/supervisor/actions/reprocess` — reprocess pending actions. Body: `{ mode }`. Mode enum: `semi-auto | auto`. Response: `{ approvedCount, remainingPending }`.

### Supervisor — loop
- `POST /v1/projects/:id/supervisor/loop` — start autonomous loop. Body: `{ maxIterations (1–20, default 5), costCapUsd? (0–100), healthScoreTarget?, autoApproveThreshold (50–100, default 80), maxConsecutiveFailures (1–10, default 2), maxDurationMinutes (10–480, default 240) }`.
- `GET /v1/projects/:id/supervisor/loop` — get current active loop.
- `GET /v1/projects/:id/supervisor/loops` — list loops. Query: `limit` (1–50, default 10), `offset`.
- `GET /v1/projects/:id/supervisor/loops/:loopId` — get loop detail with runs and actions.
- `POST /v1/projects/:id/supervisor/loop/:loopId/pause`
- `POST /v1/projects/:id/supervisor/loop/:loopId/resume`
- `POST /v1/projects/:id/supervisor/loop/:loopId/stop`

### Supervisor — analytics
- `GET /v1/projects/:id/supervisor/cost` — cost summary. Query: `days` (1–365, default 30). Response: `{ days, runsCount, totalTokens, totalCostUsd }`.
- `GET /v1/projects/:id/supervisor/trend` — health trend. Query: `days` (1–90, default 30). Response: `{ days, points: [{ date, total, score, critical, high, medium, low }] }`.
- `GET /v1/projects/:id/supervisor/summary` — project health grade. Response: `{ grade, score, openCounts, trendDirection, lastScanAt, totalRuns30d, nextRunAt }`.

### Supervisor — reports
- `GET /v1/projects/:id/supervisor/runs/:runId/compare` — diff current run vs previous. Response: `{ currentRun, previousRun, newActions, resolvedActions, persistentActions }`.
- `GET /v1/projects/:id/supervisor/runs/:runId/export` — export run as markdown. Query: `format` (default `markdown`). Response: `{ content, filename }`.

### Webhooks
- `POST /v1/webhooks/:provider` — receive webhook (GitHub/Gitea/GitLab). Auth: webhook signature verification (no Bearer token). Response: `{ received: true }`.
- `GET /v1/webhooks/routes` — list webhook routes. Response: array of `{ id, provider, repoUrl, labels, authors, machineId, repoPath, enabled, createdAt }`.
- `POST /v1/webhooks/routes` — create webhook route. Body: `{ provider, repoUrl, webhookSecret, apiToken?, labels, authors, machineId, repoPath, enabled, callbackUrl? }`. Response: `{ id, repoUrl, remoteWebhookId }`.
- `DELETE /v1/webhooks/routes/:id`
- `GET /v1/webhooks/events` — list webhook events. Query: `projectId?`, `limit` (1–100, default 20), `offset`. Response: `{ events: [...], total }`.

### Session usage
- `GET /v1/sessions/:sessionId/usage/summary` — token usage for session. Response: `{ totalInputTokens, totalOutputTokens, totalCacheCreationTokens, totalCacheReadTokens, lastInputTokens, lastOutputTokens, lastCacheCreation, lastCacheRead, reportCount }`.
- `PATCH /v1/sessions/:sessionId/restore` — restore a deleted session.

### V3 sessions (batch message sync)
- `GET /v3/sessions/:sessionId/messages` — paginated messages with sequence numbers. Query: `after_seq` (default 0), `before_seq?`, `limit` (1–500, default 100). Response: `{ messages: [{ id, seq, content, localId, createdAt, updatedAt }], hasMore }`.
- `POST /v3/sessions/:sessionId/messages` — batch-insert messages. Body: `{ messages: [{ content, localId }] }` (1–100). Response: `{ messages: [{ id, seq, localId, createdAt, updatedAt }] }`.

### Dev-only
- `POST /logs-combined-from-cli-and-mobile-for-simple-ai-debugging` (only if enabled)

## Implementation references
- API routes: `packages/happy-server/sources/app/api/routes`
- Auth module: `packages/happy-server/sources/app/auth/auth.ts`
