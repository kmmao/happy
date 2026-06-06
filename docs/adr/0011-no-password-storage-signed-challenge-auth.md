---
status: accepted
---

# Auth uses signed-challenge + public key, no passwords

The Server stores no passwords; clients sign a challenge with the private half of their public key and receive a Bearer token. We chose this because a server-side breach must not expose credentials, and public-key identity composes naturally with the E2E scope (ADR-0001).
