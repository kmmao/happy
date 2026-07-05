---
status: accepted
---

# WebhookEvent has two distinct dedup concerns, not one seam

## Context

`webhookDispatch.ts` deduplicates `WebhookEvent`s two different ways, which reads
at first glance like the same uniqueness check implemented twice:

- **Issue path** (`createWebhookEventIfNew`): inside `inTx`, `findFirst` on
  `(repoUrl, issueNumber, accountId, status notIn [skipped, failed])`; if a row
  exists, skip; else `create` a `pending` row.
- **PR-merge path** (`processRoutePRMerge`): standalone `db.webhookEvent.create`,
  catching `Prisma` `P2002` (unique-constraint violation) to detect a duplicate;
  creates a `completed` row.

A survey flagged this as "two incompatible dedup patterns — extract a shared
`webhookEventDedup` seam."

## Decision

Do NOT unify them. They are two genuinely different idempotency concerns backed
by two different DB structures (confirmed in `schema.prisma`):

- The issue path dedups on a **content key** — "is there already an *active*
  event for this issue?" — using the NON-unique `@@index([repoUrl, issueNumber])`.
  It must dedup **across deliveries** (issue-opened and issue-labeled are
  different `deliveryId`s for the same issue) and must **allow re-processing**
  after a `skipped`/`failed` outcome. That is precisely why the key is NOT a
  unique constraint and why `findFirst`-then-`create` (not create-catch) is the
  right mechanism.
- The PR-merge path dedups on the **delivery key** — "have we processed this exact
  platform delivery?" — using `@@unique([provider, deliveryId])`. `create` +
  catch-`P2002` is the correct **race-free** way to honor a DB unique constraint
  (a `findFirst`-then-`create` here would have a TOCTOU window the constraint is
  there to close).

Different keys, different DB structures, different re-processing semantics → the
mechanisms differ *because the concerns differ*. A shared `webhookEventDedup`
would have to accept both a content key and a delivery key and switch mechanism
internally — widening its interface to the union of both callers (the shallow
"one adapter per behavior" trap). One adapter each = two hypothetical seams, not
one real one.

## Consequences

- The two dedup sites stay as they are. A future architecture review seeing "two
  dedup patterns on WebhookEvent" should read this first: the split tracks two
  different idempotency keys enforced by two different schema features, not an
  accident.
- If a THIRD dedup site appears that shares one of these exact keys + mechanisms,
  that (not surface similarity) is when extracting the matching one becomes a real
  two-adapter seam.
