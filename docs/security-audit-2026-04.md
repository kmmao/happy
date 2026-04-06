# Security Audit — April 2026

Audit date: 2026-04-07
Scope: all 5 packages (happy-cli, happy-server, happy-app, happy-agent, happy-wire)

## Findings Summary

| # | Issue | Severity | Status | Owner |
|---|-------|----------|--------|-------|
| 1 | Rate limiting imported but never enabled | CRITICAL | Open | Server |
| 2 | Token cache unbounded (no TTL, no eviction) | CRITICAL | Open | Server |
| 3 | File permissions missing on ~/.happy root | CRITICAL | Open | CLI |
| 4 | Security headers not configured (no helmet) | HIGH | Open | Server |
| 5 | 99 dependency CVEs (no audit pipeline) | HIGH | Open | All |
| 6 | Web platform stores tokens in sessionStorage | MEDIUM | Acknowledged | App |
| 7 | Response validation inconsistent on App side | MEDIUM | Open | App |
| 8 | CORS defaults to localhost only (correct) | LOW | OK | Server |

## Key Findings

### 1. Rate Limiting — CRITICAL

**Location:** `packages/happy-server/sources/app/api/utils/enableRateLimit.ts`

`@fastify/rate-limit` is installed and a helper `enableRateLimit()` exists with sensible defaults (AUTH: 10 req/60s, WEBHOOK: 30 req/60s, global: 100 req/60s). However, the helper is imported in `api.ts` but **never called**. All endpoints are completely unthrottled.

**Risk:** Credential stuffing, DoS, abuse of webhook/auth endpoints.

### 2. Token Cache Memory Leak — CRITICAL

**Location:** `packages/happy-server/sources/app/auth/auth.ts:18`

```typescript
private tokenCache = new Map<string, TokenCacheEntry>();
```

Tokens are cached indefinitely with no TTL, no max size, and no eviction policy. The cache grows monotonically until the process is restarted. Compromised tokens remain valid forever in cache.

A `getCacheStats()` monitoring method exists but no automatic cleanup is triggered.

**Risk:** Memory exhaustion under load; stale/revoked tokens honored indefinitely.

### 3. Missing File Permissions — CRITICAL

**Location:** `packages/happy-cli/src/configuration.ts:84,88`

The main `~/.happy` directory and logs directory are created with `mkdirSync({ recursive: true })` **without specifying `mode`**, inheriting the default umask (typically `0o755` — world-readable). Only the `sessionKeysDir` correctly sets `mode: 0o700`.

**Risk:** Other users on multi-user systems can read CLI config and logs.

### 4. Missing Security Headers — HIGH

**Location:** `packages/happy-server/sources/app/api/api.ts`

No `@fastify/helmet` dependency. No manual header configuration. Missing:
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-XSS-Protection`

### 5. Dependency CVEs — HIGH

No `yarn audit` or `npm audit` pipeline exists. Notable concerns:
- `jsonwebtoken@^9.0.2` — known CVEs in this range
- `socket.io@^4.8.1` — prototype pollution history
- Loose semver ranges (`^`) across all packages

Run `yarn audit --level moderate` to get current count. Last informal check indicated ~99 advisories across the dependency tree.

### 6. Web localStorage Tokens — MEDIUM

**Location:** `packages/happy-app/sources/auth/tokenStorage.ts`

Native platforms correctly use `expo-secure-store` (hardware keychain). Web falls back to `sessionStorage` — better than `localStorage` since credentials clear on tab close, but still XSS-accessible. The code includes a security comment acknowledging this trade-off.

### 7. Missing Response Validation — MEDIUM

**Location:** `packages/happy-app/sources/sync/`

Some API clients use Zod `.safeParse()` for response validation (e.g., `apiFeed.ts`, `apiFriends.ts`). Others, including WebSocket message handlers (`apiSocket.ts`), trust server responses without schema validation.

### 8. CORS Configuration — LOW / OK

**Location:** `packages/happy-server/sources/app/api/api.ts:68-75`

CORS origins are read from `ALLOWED_ORIGINS` env var with safe localhost-only defaults. WebSocket CORS in `socket.ts` mirrors this. Not overly permissive.

## Wire Schema Gaps

**Location:** `packages/happy-wire/src/`

Three instances of `z.record(z.string(), z.unknown())` found:

| File | Field | Purpose |
|------|-------|---------|
| `sessionProtocol.ts:24` | `args` | Tool call arguments (intentionally dynamic) |
| `sessionEvents.ts:21` | `detail` | Event metadata (optional, flexible) |
| `sessionEvents.ts:31` | `detail` | Event metadata (optional, flexible) |

**Assessment:** Low risk. These use `z.unknown()` (requires explicit type narrowing at consumption) rather than `z.any()` (no type safety). The flexibility is intentional for tool arguments and extensible metadata. No `z.any()` usage found.

## Webhook Secret Rotation — HANDY_MASTER_SECRET

### Current Usage

`HANDY_MASTER_SECRET` is a single secret used for multiple purposes:
1. **Auth token generation/verification** — seed for privacy-kit token generators (`auth.ts`)
2. **Server-side encryption** — KeyTree derivation for encrypting GitHub OAuth tokens and vendor API keys
3. **Voice ID derivation** — HMAC-SHA256 for ElevenLabs user IDs (`voiceRoutes.ts`)
4. **Webhook verification** — HMAC signature validation uses `timingSafeEqual()` (timing-attack resistant)

### Rotation Procedure

⚠️ **No automated rotation exists.** Manual procedure:

1. **Pre-rotation:** Ensure all active CLI sessions are idle or terminated
2. **Set new secret:** Update `HANDY_MASTER_SECRET` in production environment
3. **Restart server:** All in-memory token caches are cleared
4. **Impact:**
   - All existing auth tokens are invalidated — all clients must re-authenticate
   - All server-encrypted tokens (GitHub OAuth, vendor keys) become unreadable — users must reconnect integrations
   - ElevenLabs voice user IDs change — voice history may be orphaned
5. **Mitigation:** Consider implementing dual-secret support (old + new) with a migration window

**Recommendation:** Split `HANDY_MASTER_SECRET` into purpose-specific secrets so rotation of one doesn't cascade to all subsystems.

## Certificate Pinning — Future Consideration

Currently no certificate pinning is implemented in happy-app or happy-cli. The system relies on standard TLS certificate validation.

**When to implement:**
- If the app handles financial transactions or highly sensitive credentials
- If targeted MITM attacks become a realistic threat model
- If app store distribution is the only distribution channel (pinning breaks dev/test proxies)

**Implementation approach if needed:**
- React Native: `react-native-ssl-pinning` or `TrustKit` integration
- CLI: Node.js `tls.checkServerIdentity` with pinned certificate hashes
- Pin backup certificates to avoid lockout on rotation

**Current assessment:** Not urgent. E2E encryption already protects content confidentiality even if TLS is compromised. Pinning would add defense-in-depth for the auth handshake.

## .env.dev Files — Credential Review

### `packages/happy-cli/.env.dev`

```
DEBUG=1
NODE_NO_WARNINGS=1
```

✅ **Safe** — contains only debug flags, no credentials.

### `packages/happy-server/.env.dev`

| Variable | Value | Assessment |
|----------|-------|------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/handy` | ✅ Local dev default |
| `HANDY_MASTER_SECRET` | `your-super-secret-key-for-local-development` | ✅ Placeholder, clearly non-production |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `minioadmin` / `minioadmin` | ✅ MinIO defaults |
| `DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING` | `true` | ⚠️ Dev-only flag, name makes risk clear |

✅ **Safe** — all values are local development defaults or well-known placeholders. No production credentials present.

## Remediation Timeline

### Immediate (this sprint)

| # | Action | Effort |
|---|--------|--------|
| 1 | Call `enableRateLimit()` in `api.ts` startup | 1 line |
| 3 | Add `mode: 0o700` to `~/.happy` and logs `mkdirSync` calls | 2 lines |
| 4 | Install and register `@fastify/helmet` | 15 min |

### Short-term (2 weeks)

| # | Action | Effort |
|---|--------|--------|
| 2 | Add TTL + max-size eviction to token cache (LRU with 1h TTL) | 2h |
| 5 | Add `yarn audit` to CI pipeline, triage critical CVEs | 4h |
| 7 | Add Zod validation to remaining App API clients and socket handlers | 4h |

### Medium-term (1 month)

| # | Action | Effort |
|---|--------|--------|
| — | Split `HANDY_MASTER_SECRET` into per-purpose secrets | 1d |
| — | Implement dual-secret rotation window for auth tokens | 1d |
| 6 | Evaluate httpOnly cookie auth for web platform | 2d |
| — | Set up automated dependency scanning (Dependabot or Snyk) | 2h |

### Future (evaluate quarterly)

| # | Action | Trigger |
|---|--------|---------|
| — | Certificate pinning | If threat model escalates or app handles payments |
| — | Tighten Wire `z.unknown()` schemas | If unexpected data causes bugs |
