---
status: accepted
---

# Local tool surface goes via Socket.IO RPC, not REST

The Session and Daemon expose bash / file / ripgrep / difftastic over Socket.IO RPC (`rpc-register` + `rpc-call`), not REST endpoints. We chose this because shell + arbitrary-file capabilities on a public REST surface are a far larger attack surface than the same capabilities scoped to an authenticated Socket.IO room of a single Session.
