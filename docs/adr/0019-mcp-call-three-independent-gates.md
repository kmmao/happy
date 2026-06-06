---
status: accepted
---

# MCP tool invocation requires 3 independent gates by default-deny

Tier-3 MCP tool calls pass three independent gates: (1) target server in `HAPPY_SIDEBAR_MCP_WHITELIST`, (2) tool name matches `mcp__<server>__<tool>`, (3) App echoes a per-call `clientConfirmToken` from its 2-step dialog. Single-gate models fail open on any one bug; three independent gates require an attacker to break all three.
