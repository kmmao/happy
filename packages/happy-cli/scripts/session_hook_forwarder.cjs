#!/usr/bin/env node
/**
 * Session Hook Forwarder
 *
 * Executed by Claude's hook system (SessionStart and the other observability
 * events registered in `generateHookSettings.ts`). Reads the hook JSON
 * payload from stdin and POSTs it to Happy's local hook server.
 *
 * Usage: echo '{"session_id":"..."}' | node session_hook_forwarder.cjs <port>
 *
 * Env-var enrichment (Claude Code 2.1.133+):
 *   Claude exports `$CLAUDE_EFFORT` (and friends) to hook subprocesses so
 *   they can read the current effort level without depending on a JSON
 *   field that older CLIs didn't write. We fold that value back into the
 *   payload as `effort.level` when the payload doesn't already carry one,
 *   so downstream consumers can rely on a single shape.
 */

const http = require('http');

const port = parseInt(process.argv[2], 10);

if (!port || isNaN(port) || port < 1 || port > 65535) {
    process.exit(1);
}

const chunks = [];

process.stdin.on('data', (chunk) => {
    chunks.push(chunk);
});

process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks);
    const body = enrichWithEnv(raw);

    const req = http.request({
        host: '127.0.0.1',
        port: port,
        method: 'POST',
        path: '/hook',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': body.length
        }
    }, (res) => {
        res.resume(); // Drain response
    });

    req.on('error', () => {
        // Silently ignore errors - don't break Claude
    });

    req.end(body);
});

process.stdin.resume();

/**
 * Fold environment-only hook context back into the JSON payload so the
 * server side sees a single uniform shape. Today this is just
 * `$CLAUDE_EFFORT` → `effort.level`; the function is structured to make
 * adding the next env-only field a one-liner.
 *
 * Falls back to the original raw bytes verbatim on any parse / shape
 * mismatch — we never want to drop a hook just because Claude added a new
 * top-level field we don't recognise.
 */
function enrichWithEnv(raw) {
    const claudeEffort = process.env.CLAUDE_EFFORT;
    if (!claudeEffort) return raw;
    let parsed;
    try {
        parsed = JSON.parse(raw.toString('utf-8') || '{}');
    } catch (_err) {
        return raw;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return raw;
    }
    // Only enrich when the in-body channel didn't already provide a level.
    // `effort` may legally be either a string (e.g. "high") or an object
    // (`{ level: "high" }`) depending on the CLI version, so we leave any
    // existing value alone.
    if (parsed.effort === undefined || parsed.effort === null) {
        parsed.effort = { level: claudeEffort };
    } else if (
        typeof parsed.effort === 'object'
        && !Array.isArray(parsed.effort)
        && parsed.effort.level === undefined
    ) {
        parsed.effort.level = claudeEffort;
    }
    return Buffer.from(JSON.stringify(parsed));
}
