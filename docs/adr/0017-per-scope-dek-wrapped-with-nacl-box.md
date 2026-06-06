---
status: accepted
---

# Per-Session/Machine DEK wrapped with NaCl box ephemeral keypair

Per-Session and per-Machine Data Encryption Keys (AES-256-GCM) are wrapped for storage/transport with `tweetnacl.box` using an ephemeral keypair. We chose this because (a) compromising one Session's content does not require rotating any other Session's key; (b) `box` is the same primitive used elsewhere in the stack — no extra crypto surface.
