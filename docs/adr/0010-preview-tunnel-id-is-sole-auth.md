---
status: accepted
---

# PreviewTunnel uses its 12-char tunnelId as sole authentication

The PreviewTunnel `/preview/{tunnelId}` path is gated by the 12-char random tunnelId alone. We accept this because the Server uses Bearer tokens, tunnelId carries ~62 bits of entropy, and tunnels are short-lived (8 h lease).
