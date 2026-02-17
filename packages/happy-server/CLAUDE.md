# happy-server CLAUDE.md

## Folder Structure
```
/sources
├── /app           # Application entry points
├── /apps/api      # API server with /routes
├── /modules       # Reusable modules (ai, eventbus, lock, media)
├── /utils         # Low-level utilities (name file = function name)
├── /recipes       # Standalone scripts
├── /services      # Core services (pubsub)
└── /storage       # DB client, inTx, cache
```

## Key Modules
- **ai**: AI service wrappers
- **eventbus**: Local or Redis-based; use `afterTx` to emit after commit
- **lock**: Cluster-wide resource locking
- **media**: Media file processing (requires FFmpeg + Python3)

## Remote Logging
Set `DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING=true` to enable.
Logs: `.logs/MM-DD-HH-MM-SS.log`. Mobile/CLI logs sent to `/logs-combined-from-cli-and-mobile-for-simple-ai-debugging`.

## Server-Specific Rules
- Prefix action files with entity then action (e.g., `friendAdd.ts`, `sessionCreate.ts`)
- Write prompts to `_prompts.ts` relative to the application
- After writing an action, add a doc comment explaining logic; keep in sync
- Do not return data from action functions "just in case" — only essentials
- Do not add logging unless asked
- Do not run non-transactional things (file uploads) inside transactions
- Always use GitHub usernames
- Modules should not depend on application-specific logic
