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

## Database migrations

**`yarn generate` does NOT create a migration.** It is `prisma generate` — it
regenerates the Prisma client from `schema.prisma` and nothing else. Editing the
schema and running `yarn generate` leaves the database untouched, which shows up
later as a P2021/P2022 (`table/column does not exist`) at runtime.

**`yarn migrate` (`prisma migrate dev`) cannot run in this repo.** It replays all
70 migrations into a shadow database, but `Project`, `Skill` and `Task` have no
`CREATE TABLE` migration at all — the baseline was established with `db push` and
only later increments were recorded. The replay dies on
`20260328_embedding_768dim`, which `ALTER`s a table the shadow DB never created:

```
Error: P3006 … failed to apply cleanly to the shadow database
       The underlying table for model `ProjectKnowledge` does not exist.
```

Production is unaffected: `docker-compose.yml:106` runs `prisma migrate deploy`,
which applies migration files in order and never builds a shadow database.

### Working procedure for a schema change

```bash
# 1. Edit schema.prisma, then derive the DDL (never hand-write it)
npx dotenv -e .env.dev -- npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script

# 2. Review the output. `migrate diff` compares the LIVE DB against the schema,
#    so it also surfaces pre-existing drift unrelated to your change — drop
#    those hunks. (A real case: it proposed DROP INDEX
#    "Session_parentSessionId_idx", a live index that only looked orphaned
#    because schema.prisma had never declared the matching @@index.)

# 3. Save the reviewed DDL as a migration
mkdir -p prisma/migrations/YYYYMMDD_description
$EDITOR prisma/migrations/YYYYMMDD_description/migration.sql

# 4. Apply locally
npx dotenv -e .env.dev -- npx prisma db execute \
  --file prisma/migrations/YYYYMMDD_description/migration.sql

# 5. Register it so migrate deploy won't re-run it
npx dotenv -e .env.dev -- npx prisma migrate resolve \
  --applied YYYYMMDD_description

# 6. Confirm schema and database now agree — this must print an empty migration
npx dotenv -e .env.dev -- npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script

# 7. yarn generate, then typecheck + test
```

Commit the migration file: `migrate deploy` is what applies it everywhere else.

### Rules

- **Never invent DDL.** Always start from `migrate diff` output, then prune it.
- **Never delete an old migration directory**, including ones for features that
  have been removed. They are replayed in order on every fresh deployment; a
  later `ALTER TABLE` against a table whose `CREATE` you deleted breaks the chain.
- Destructive migrations (`DROP TABLE`/`DROP COLUMN`) are one-way. Take a
  `pg_dump` first and export anything worth keeping.

## Server-Specific Rules
- Prefix action files with entity then action (e.g., `friendAdd.ts`, `sessionCreate.ts`)
- Write prompts to `_prompts.ts` relative to the application
- After writing an action, add a doc comment explaining logic; keep in sync
- Do not return data from action functions "just in case" — only essentials
- Do not add logging unless asked
- Do not run non-transactional things (file uploads) inside transactions
- Always use GitHub usernames
- Modules should not depend on application-specific logic
