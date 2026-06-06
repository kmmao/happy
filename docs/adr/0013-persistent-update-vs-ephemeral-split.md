---
status: accepted
---

# Updates persist with seq; presence is ephemeral and not replayed

Sync events split into persistent `update` (with `seq`, DB-backed, replayed on reconnect) and `ephemeral` (presence/usage, in-memory, dropped). We chose this because presence churns at >1 Hz per Session — persisting it would dominate writes while adding no value (stale presence after reconnect is useless anyway).
