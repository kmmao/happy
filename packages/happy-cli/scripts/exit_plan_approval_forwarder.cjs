#!/usr/bin/env node
/**
 * ExitPlanMode approval forwarder (Claude TUI `PreToolUse` hook).
 *
 * Purpose
 * -------
 * Blocking bridge between the TUI's PreToolUse hook and Happy's local
 * `hookServer`. Reads the PreToolUse JSON payload on stdin, POSTs it to
 * `http://127.0.0.1:<port>/hook` with `hook_event_name` overridden to
 * `"ExitPlanApproval"`, then WAITS for the server's response body and
 * writes it verbatim to stdout.
 *
 * The server side does the actual work: pushes an entry into
 * `agentState.requests` so the App shows its plan-review picker,
 * blocks until the user approves/rejects/times out, and returns a
 * `{"hookSpecificOutput": {...}}` JSON that Claude reads to decide
 * whether the ExitPlanMode tool call is allowed or denied.
 *
 * Why not reuse session_hook_forwarder.cjs
 * ----------------------------------------
 * That forwarder is fire-and-forget — it doesn't wait for the server
 * response (`res.resume()` just drains). Session-start / stop-failure /
 * observability hooks don't need a response; ExitPlanMode does. Keeping
 * the two forwarders separate preserves the fire-and-forget contract for
 * every other hook.
 *
 * Failure posture
 * ---------------
 * Any network error → emit nothing and exit 0. The TUI then falls back
 * to its in-terminal picker (the same behaviour as when no hook is
 * installed) instead of crashing the tool call.
 *
 * Usage: echo '{"tool_name":"ExitPlanMode","tool_input":{"plan":"..."}}' \
 *          | node exit_plan_approval_forwarder.cjs <port>
 */

const http = require("http");

const port = parseInt(process.argv[2], 10);
if (!port || Number.isNaN(port) || port < 1 || port > 65535) {
  process.exit(1);
}

const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  let payload;
  try {
    const rawStr = Buffer.concat(chunks).toString("utf-8") || "{}";
    payload = JSON.parse(rawStr);
  } catch (_err) {
    process.exit(0);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    process.exit(0);
  }
  // Defense-in-depth: `mergeExitPlanAutoApproveIntoSettings` already scopes
  // the matcher to ExitPlanMode. If a broader matcher ever routes another
  // tool here we must not block on it — emit nothing and let the TUI take
  // its normal path.
  if (payload.tool_name && payload.tool_name !== "ExitPlanMode") {
    process.exit(0);
  }

  // Force the event name so hookServer's dispatch table routes us to the
  // ExitPlanApproval handler regardless of what the TUI called it.
  payload.hook_event_name = "ExitPlanApproval";

  const body = Buffer.from(JSON.stringify(payload));

  // No client-side timeout: the server enforces the wait window via
  // HAPPY_EXIT_PLAN_APPROVAL_TIMEOUT_MS. If the connection drops, `error`
  // fires and we fall back to silent-exit → TUI in-terminal picker.
  const req = http.request(
    {
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/hook",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": body.length,
      },
    },
    (res) => {
      const respChunks = [];
      res.on("data", (chunk) => respChunks.push(chunk));
      res.on("end", () => {
        // Only surface the body when the server returned JSON (status 200
        // + JSON content-type). Anything else — plain-text "ok", 4xx, 5xx —
        // is treated as "no decision from server" and falls back silently.
        const ct = String(res.headers["content-type"] || "").toLowerCase();
        if (res.statusCode === 200 && ct.includes("application/json")) {
          const body = Buffer.concat(respChunks);
          // `process.stdout.end(buf, cb)` waits for the write to drain (and
          // the FD to close) before running `cb` — the only guaranteed way
          // to avoid `process.exit(0)` truncating stdout before Claude TUI
          // reads it. A bare `process.stdout.write(buf); process.exit(0)`
          // can drop the tail of the JSON when the pipe buffer is momentarily
          // full (typical when `updatedInput` mirrors a multi-KB plan).
          process.stdout.end(body, () => process.exit(0));
          return;
        }
        process.exit(0);
      });
      res.on("error", (err) => {
        // Surface transport errors on stderr for operator debuggability —
        // stdout is reserved for the hook decision, so stderr is safe.
        // TUI hook pipeline discards stderr but happy's log capture
        // channels it, giving a signal for the "picker never showed" bug.
        try { process.stderr.write(`[exit-plan-forwarder] response error: ${err.message}\n`); } catch { /* nothing to do */ }
        process.exit(0);
      });
    },
  );

  req.on("error", (err) => {
    try { process.stderr.write(`[exit-plan-forwarder] request error: ${err.message}\n`); } catch { /* nothing to do */ }
    process.exit(0);
  });
  req.end(body);
});

process.stdin.resume();
