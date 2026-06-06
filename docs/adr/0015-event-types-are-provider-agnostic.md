---
status: accepted
---

# Event types are provider-agnostic (no claude/codex in wire)

Session-protocol event types (`text`, `tool-call-start`, `turn-start`, …) name no provider. We chose this because the App renders the same UI regardless of Claude / Codex / Gemini / future backends; provider-named events would force every adapter and client to fan out on backend identity, locking us out of cheaply adding new providers.
