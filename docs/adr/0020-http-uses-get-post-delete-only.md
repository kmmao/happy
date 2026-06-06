---
status: accepted
---

# HTTP uses GET/POST/DELETE only, not full REST

The HTTP API uses GET for reads, POST for mutations + actions, DELETE for unambiguous deletions — no PUT, no PATCH. We chose this because many actions span multiple entities or have non-CRUD semantics ("spawn a session", "rotate an access key"); forcing them into the full REST palette either misleads the client or invents URLs that contradict the verb.
