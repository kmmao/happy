# E2E encryption with zero-knowledge server

All user content (Session messages, Machine metadata, Knowledge, Artifacts, etc.) is encrypted client-side before reaching the Server. The Server stores ciphertext only and cannot read, search, or moderate content. Encryption uses AES-256-GCM / NaCl secretbox with per-Session ephemeral keys (AccessKey).

We chose this because Happy proxies sensitive data — source code, AI conversations, credentials in prompts — between a user's phone and their development machine. A server-side breach must not expose that content. The trade-off: the Server cannot offer full-text search, content-based recommendations, or account recovery if the client loses key material. Features that need server-side visibility (e.g. filtering, sorting) must rely on plaintext metadata fields (tags, categories, timestamps) explicitly designed for that purpose.

**Considered alternatives:**
- Server-side encryption at rest (simpler, but a breach exposes everything)
- Hybrid approach with selective plaintext fields (current approach already uses this for indexing metadata, but conversation content stays encrypted)
