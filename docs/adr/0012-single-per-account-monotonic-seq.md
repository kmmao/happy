---
status: accepted
---

# Sync uses a single per-Account monotonic seq

All persistent updates for one Account carry a single monotonic `seq` from `Account.seq`, not per-Session or per-entity counters. We chose this because client reconciliation collapses to "apply updates in order"; the cost is single-writer contention on the counter, acceptable for the App's read-heavy workload.
