/**
 * Patch Claude Code SDK to prevent AskUserQuestion from being deferred.
 *
 * Background:
 *   SDK >= 0.2.81 introduced a "deferred tools" mechanism controlled by
 *   server-side GrowthBook feature flags (tengu_defer_all_bn4).  When the
 *   flag is active, AskUserQuestion becomes a deferred tool — the model must
 *   first call ToolSearch to fetch its schema before it can use it.  In
 *   practice the model skips this extra step and falls back to plain-text
 *   options, so the interactive step-based Q&A UI never appears.
 *
 *   This script patches the minified isDeferredTool() function (exported as
 *   `RD`) to short-circuit for AskUserQuestion, keeping it always available.
 *
 * How it works:
 *   Locates the isDeferredTool function by matching known signatures and
 *   injects an early return for AskUserQuestion before any other checks.
 *   Supports multiple SDK versions (function name changes across minified builds).
 *
 * This runs as a postinstall hook — safe to re-run, idempotent.
 */

const fs = require('fs');
const path = require('path');

const SDK_CLI_PATH = path.resolve(
    __dirname,
    '../node_modules/@anthropic-ai/claude-agent-sdk/cli.js',
);

// Regex matching isDeferredTool by its unique .isMcp===!0 check pattern.
// Captures: function name, param name, any preamble checks before isMcp.
const IS_DEFERRED_RE = /function\s+(\w+)\((\w+)\)\{((?:if\(\2\.\w+===!0\)return![01];)*)if\(\2\.isMcp===!0\)return!0;/;
const ALREADY_PATCHED_RE = /\.name==="AskUserQuestion"\)return!1;.{0,120}\.isMcp===!0\)return!0;/;

function patch() {
    if (!fs.existsSync(SDK_CLI_PATH)) {
        return;
    }

    const content = fs.readFileSync(SDK_CLI_PATH, 'utf8');

    if (ALREADY_PATCHED_RE.test(content)) {
        console.log('[patch-sdk] AskUserQuestion already patched — skipping');
        return;
    }

    const match = content.match(IS_DEFERRED_RE);
    if (!match) {
        console.warn('[patch-sdk] WARNING: isDeferredTool not found — patch may need updating');
        return;
    }

    const [original, funcName, paramName, preamble] = match;
    const patched = `function ${funcName}(${paramName}){if(${paramName}.name==="AskUserQuestion")return!1;${preamble}if(${paramName}.isMcp===!0)return!0;`;

    fs.writeFileSync(SDK_CLI_PATH, content.replace(original, patched), 'utf8');
    console.log(`[patch-sdk] Patched isDeferredTool (fn=${funcName}) — AskUserQuestion is now always available`);
}

patch();
