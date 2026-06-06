---
status: accepted
---

# Claude Control RPCs are classified into three data tiers

`claude-control:*` RPCs are classified into Tier 1 (plaintext-safe — cost numbers, versions), Tier 2 (E2E content — file reads + suggestions, with path blacklist), and Tier 3 (permission-gated — MCP calls). We chose explicit tiers because each RPC must be evaluated independently against the zero-knowledge promise (ADR-0001); a uniform policy would either over-protect Tier 1 or under-protect Tier 3.
