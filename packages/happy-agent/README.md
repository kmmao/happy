# Happy Agent

CLI client for controlling Happy Coder agents remotely.

Unlike `happy-cli` which both runs and controls agents, `happy-agent` only controls them — creating sessions, sending messages, reading history, monitoring state, and stopping sessions.

## Installation

From the monorepo:

```bash
yarn workspace happy-agent build
```

Or link globally:

```bash
cd packages/happy-agent && yarn link
```

## Authentication

Happy Agent uses account authentication via QR code, the same flow as linking a device in the Happy mobile app.

```bash
# Authenticate by scanning QR code with the Happy mobile app
happy-agent auth login

# Check authentication status
happy-agent auth status

# Clear stored credentials
happy-agent auth logout
```

Credentials are stored at `~/.happy/agent.key`.

## Commands

### List sessions

```bash
# List all sessions
happy-agent list

# List only active sessions
happy-agent list --active

# Output as JSON
happy-agent list --json
```

### Session status

```bash
# Get live session state (supports ID prefix matching)
happy-agent status <session-id>

# Output as JSON
happy-agent status <session-id> --json
```

### Session summary

```bash
# Show the narrative session summary stored in metadata.sessionSummary
happy-agent summary show <session-id>

# Output the summary as JSON
happy-agent summary show <session-id> --json

# Ask the agent to rewrite the session summary
happy-agent summary refresh <session-id>

# Require a real summary update before returning
happy-agent summary refresh <session-id> --require-summary

# Wait for the agent to finish, then print the latest summary
happy-agent summary refresh <session-id> --wait
```

### Create a session

```bash
# Create a new session with a tag
happy-agent create --tag my-project

# Specify a working directory
happy-agent create --tag my-project --path /home/user/project

# Output as JSON
happy-agent create --tag my-project --json
```

### Send a message

```bash
# Send a message to a session
happy-agent send <session-id> "Fix the login bug"

# Send and wait for the agent to finish
happy-agent send <session-id> "Run the tests" --wait

# Output as JSON
happy-agent send <session-id> "Hello" --json
```

### Message history

```bash
# View message history
happy-agent history <session-id>

# Limit to last N messages
happy-agent history <session-id> --limit 10

# Output as JSON
happy-agent history <session-id> --json
```

### Stop a session

```bash
happy-agent stop <session-id>
```

### Wait for idle

```bash
# Wait for agent to become idle (default 300s timeout)
happy-agent wait <session-id>

# Custom timeout
happy-agent wait <session-id> --timeout 60
```

Exit code 0 when agent becomes idle, 1 on timeout.

## Environment Variables

- `HAPPY_SERVER_URL` - API server URL (default: `https://s.sangreal.code.xycloud.info:2443`)
- `HAPPY_HOME_DIR` - Home directory for credential storage (default: `~/.happy`)

## Session ID Matching

All commands that accept a `<session-id>` support prefix matching. You can provide the first few characters of a session ID and the CLI will resolve the full ID.

## Encryption

All session data is end-to-end encrypted. New sessions use AES-256-GCM with per-session keys. Existing sessions created by other clients are decrypted using the appropriate key scheme (AES-256-GCM or legacy NaCl secretbox).

## Requirements

- Node.js >= 20.0.0
- A Happy mobile app account for authentication

## Publishing to npm

Maintainers can publish a new version:

```bash
yarn release               # From repo root: choose library to release
# or directly:
yarn workspace happy-agent release
```

This flow:
- runs tests/build checks via `prepublishOnly`
- creates a release commit and `happy-agent-vX.Y.Z` tag
- creates a GitHub release with generated notes
- publishes `happy-agent` to npm

## License

MIT
