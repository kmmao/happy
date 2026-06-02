# ADR 0006: Preview state is in-memory only

**Status:** Accepted  
**Date:** 2026-06-02

## Context

PreviewCandidate and PreviewTunnel are ephemeral debugging aids — they live for minutes to hours during active frontend development, not days or weeks. Every other first-class entity (Session, Task, Knowledge) is persisted in PostgreSQL.

We considered persisting Preview state to the database, but:
- A server restart during an active preview is rare and low-impact: the Daemon re-reports the candidate on reconnect, and the Account recreates the tunnel in one click.
- Adding a Prisma migration for two tables that hold transient data adds schema maintenance cost for marginal benefit.
- The previewStore cleanup timer (60s sweep) already handles lease expiry and idle timeout — there's no need for durable cleanup.

## Decision

Store PreviewCandidates and PreviewTunnels in an in-memory `Map` on the Server (previewStore.ts). No database persistence.

## Consequences

- Server restart clears all active previews. The App shows stale state until the next ephemeral event or manual refresh.
- No audit trail for preview usage (acceptable — previews are transient by nature).
- If preview adoption grows to the point where multi-server deployment is needed, this decision must be revisited (shared state via Redis or DB).
