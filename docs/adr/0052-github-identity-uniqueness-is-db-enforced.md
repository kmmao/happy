---
status: accepted
---

# GitHub identity uniqueness is enforced by the DB, not the pre-check in `githubConnect`

## Context

`githubConnect` (`sources/app/github/githubConnect.ts`) reads like a
time-of-check/time-of-use race: it checks whether the incoming `githubUserId` is
already connected to another **Account** (step 2), disconnects that Account, then
in a later transaction upserts the `GithubUser` row and links it to the current
Account (step 4). An architecture review flagged the window between the check and
the write as a TOCTOU hole where a racing connect could "silently overwrite" the
link.

That reading misses where the invariant actually lives. `Account.githubUserId` is
`@unique` in `prisma/schema.prisma`:

```prisma
githubUserId    String?     @unique
githubUser      GithubUser? @relation(fields: [githubUserId], references: [id])
```

So the database — not the pre-check — guarantees "at most one Account per GitHub
identity." If two connects for the same identity race, both may pass the step-2
check, but only one `account.update` can set `githubUserId` to that value; the
second fails with a unique-constraint violation and its transaction rolls back.
There is **no silent overwrite and no data corruption** — the losing racer errors.

The step-2 disconnect exists only as a UX optimization: in the common case (a user
re-connecting a GitHub identity previously owned by a stale/abandoned Account) it
clears the prior owner so the `@unique` constraint does not fire on a legitimate
re-connect. It is not the safety mechanism.

## Decision

**No change.** Keep the pre-check + DB `@unique` as the design. Do NOT move the
uniqueness check + disconnect inside the step-4 transaction to "close the window":

- `githubDisconnect` performs non-transactional work (it emits a SyncUpdate, and
  more), and the server rule is that non-transactional operations must not run
  inside a transaction.
- The window's only observable effect is that a rare concurrent double-connect of
  the *same* identity surfaces a unique-constraint error to one caller instead of a
  hand-crafted message — a minor UX nit, not a correctness bug.

## Consequences

- A future review re-flagging the "TOCTOU" in `githubConnect` should read this
  first: the `@unique` constraint is the guard; the pre-check is an optimization.
- If the losing-racer's raw Prisma error ever needs a friendlier surface, handle it
  at the route/error-mapping layer — do not restructure `githubConnect` into a
  single transaction.
- If `Account.githubUserId` ever loses its `@unique` constraint, this ADR is void
  and the race becomes a real corruption hole — the constraint is load-bearing.
