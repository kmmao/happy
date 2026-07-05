---
status: accepted
---

# The bidirectional friendship transition is owned by one pure seam

## Context

A friendship between two Accounts is a PAIR of directed `UserRelationship` rows
— `current→target` and `target→current` — that must stay mutually consistent
(friend⟺friend, requested⟺pending, …). The rules for moving that pair lived
inline in two action files:

- `friendAdd.ts` — accept-incoming / send-request / no-op,
- `friendRemove.ts` — decline / unfriend / clear-pending / no-op.

Each file independently read the pair (`relationshipGet` both directions) and
then re-derived, in an `if` ladder, what both sides become — including the
conditional writes (add brings the target to `pending` only if it was `none`;
remove clears the target only if it hadn't `rejected` us). The pair-consistency
invariant had no owner and no test: verifying "does unfriending leave a coherent
pair?" meant driving a Prisma transaction, and a change to one side's rule
required remembering to mirror it in the other file.

## Decision

`sources/app/social/decideRelationshipTransition.ts` owns the transition as a
pure, total function `decideRelationshipTransition(op, currentStatus, targetStatus)
→ RelationshipTransition`. The result carries the new pair (`currentNext` /
`targetNext`, `undefined` = leave unchanged), the notification to fire
(`friendship-established` / `friend-request`, add-path only), and the
`resultStatus` to surface in the returned profile.

`friendAdd` / `friendRemove` keep ownership of the transaction, the account
reads, the `relationshipSet` writes, and the notification sends — they read the
pair, call the decision, then apply it. The decision touches no DB and no I/O.

## Consequences

- The full transition table is exhaustively unit-tested
  (`decideRelationshipTransition.spec.ts`) — every (op, currentStatus,
  targetStatus) branch, the target=requested precedence, and the two conditional
  `targetNext` cases — without a Prisma transaction. The interface is the test
  surface.
- A rule change (or a new operation like block/unblock) is one edit in the
  decision + one spec update; both callers apply it by construction, so the two
  sides cannot silently drift.
- The two action files shrink to read → decide → apply, and `RelationshipStatus`
  is no longer branched on inline in either.
- Deliberately NOT folded in: the account-read scaffolding (`findUnique` ×2 +
  null check) stays inline in each caller — extracting it would be a thin data
  helper that only moves complexity, not a deep seam.
