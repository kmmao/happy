# happy-cli CLAUDE.md

## CLI-Specific Rules
- Do NOT create trivial getter/setter functions
- Avoid excessive `if` statements; prefer better design over control flow changes
- Use AbortController for cancellable operations
- Careful process lifecycle and cleanup handling

## Claude Session Resume Behavior
When using `--resume`, Claude creates a NEW session file with a new ID (original unchanged). All historical messages get their sessionId rewritten to the new ID. Context is fully preserved under the new session identity.
