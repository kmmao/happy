---
status: accepted
---

# Session protocol is custom, not ACP

Happy uses a custom session-protocol instead of ACP. ACP assumes plaintext REST + SSE (we are E2E), models tool calls as debugging metadata (we render them with permission dialogs and spinners), and lacks image dimensions / thumbhash for instant placeholder layout. We adopt ACP's lifecycle / content separation but not its wire.
