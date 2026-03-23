# happy-server CLAUDE.md

## Folder Structure
```
/sources
├── /app              # Application domains
│   ├── /api          # API server (/routes, /socket, /utils)
│   ├── /auth         # Authentication
│   ├── /events       # Event handling
│   ├── /feed         # Feed system
│   ├── /github       # GitHub integration
│   ├── /kv           # Key-value operations
│   ├── /monitoring   # Monitoring
│   ├── /presence     # Presence tracking
│   ├── /session      # Session management
│   ├── /social       # Social features
│   └── /webhook      # Webhook handlers
├── /modules          # Reusable modules (encrypt, github, push, supervisor)
├── /utils            # Low-level utilities (name file = function name)
└── /storage          # DB client, inTx, cache
```

## Key Modules
- **encrypt**: Encryption utilities
- **github**: GitHub API integration
- **pushSend**: Push notification delivery
- **supervisor***: Supervisor system (config, loop engine, scheduling, scoring, limits, fix watchdog, usage)

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
