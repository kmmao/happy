---
status: accepted
---

# RPC method names are server-observable (E2E boundary)

The Socket.IO `rpc-call` event carries the method name (e.g. `claude-control:mcp_call`) in plaintext for routing. The Server knows that an RPC of a given kind happened and when, but not its parameters or response. We accept this because per-method routing and rate-limiting require plaintext method names; obfuscating the vocabulary would harden a non-secret without protecting anything the zero-knowledge promise actually covers.
