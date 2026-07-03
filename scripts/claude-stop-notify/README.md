# claude-stop-notify

A Claude Code **Stop hook** that sends a compact [ntfy](https://ntfy.sh) push
when a turn ends — showing the run **duration** in the title and the
**meaningful content** of the turn in the body.

It is loop-aware: for Happy autonomous-loop sessions it does *not* echo the
injected `# Happy Autonomous Loop …` boilerplate (which just overflows the
notification and gets cut with `…`). Instead it surfaces **what the agent
actually did that iteration** — the last assistant text message, summarized.

| Session type | Notification title | Notification body |
|--------------|--------------------|-------------------|
| Normal       | `myproject · 2m12s` | your original prompt for the turn |
| Autonomous loop | `myproject · 6m15s` | last assistant message (iteration summary) |
| Loop, ended on a tool call | `myproject · …` | `Autonomous loop iteration (<loopId>)` |
| No transcript (fallback) | — | `Task Completed in <project> @ <time>` |

## Files

| File | Purpose |
|------|---------|
| `happy-stop-notify` | the hook script (installed to `~/.claude/bin/`) |
| `install.sh` | copy the hook + wire it into `settings.json` (idempotent, with backup) |
| `README.md` | this document |

## Install

```bash
scripts/claude-stop-notify/install.sh
```

This will:
1. check runtime deps (`jq`, `perl`, `python3`, `ntfy`),
2. copy `happy-stop-notify` → `~/.claude/bin/happy-stop-notify` (`chmod 0755`),
3. idempotently add the Stop hook to `~/.claude/settings.json`, backing the
   file up to `settings.json.bak.<timestamp>` first.

Re-running is safe — it detects an existing entry and won't duplicate it. It
also preserves any other Stop hooks you already have.

### Uninstall

```bash
scripts/claude-stop-notify/install.sh --uninstall
```

Removes the hook binary and its `settings.json` entry (leaving unrelated Stop
hooks, deps, and backups untouched).

## Configuration

| Env var | Default | Meaning |
|---------|---------|---------|
| `HAPPY_STOP_NOTIFY_TOPIC` | `ntfy.zmddg.com/claude` | ntfy topic or full URL to publish to |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | where the hook + `settings.json` live (read by `install.sh`) |

To point a machine at a different topic, export it where Claude Code can see
it (e.g. your shell profile):

```bash
export HAPPY_STOP_NOTIFY_TOPIC="ntfy.sh/my-private-topic"
```

The hook process inherits the environment of the Claude Code session that
launches it.

## What `settings.json` ends up with

```jsonc
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "/Users/you/.claude/bin/happy-stop-notify" } ] }
    ]
  }
}
```

## Requirements

- **jq** — parse the hook payload + edit `settings.json`
- **perl** (with core `MIME::Base64`) — clean/extract prompt & assistant text
- **python3** — ISO-8601 duration math
- **ntfy** CLI — the notifier (`ntfy send …`); see <https://docs.ntfy.sh/>
- macOS *or* Linux — line reversal uses `tail -r` on macOS, `tac` on Linux

The hook is written to **never fail the harness**: a non-zero Stop hook would
block Claude from stopping, so every failure path degrades to a best-effort
send or a silent `exit 0`.

## How it works

1. Reads the JSON payload (`transcript_path`, `cwd`) from stdin.
2. Walks the transcript **newest-first**, skipping harness-injected wrapper
   messages (`<task-notification>`, `<system-reminder>`, hook stubs, …) to find
   the turn's real user prompt; its timestamp anchors the duration.
3. Computes duration = last-assistant-timestamp − prompt-timestamp.
4. Chooses the body (prompt vs. loop iteration summary — see the table above).
5. Publishes via `ntfy send --title "<project> · <dur>" <topic> "<body>"`.

Records are passed from `jq` to `perl` **base64-encoded**, so the pipeline
carries no separator/control characters and stays portable.

## Related

- Autonomous loops: `docs/manuals/operations/happy-loop-operations-playbook.md`
- The injected loop prompt template lives in
  `packages/happy-cli/src/automation/AgentLoopMemory.ts`.
