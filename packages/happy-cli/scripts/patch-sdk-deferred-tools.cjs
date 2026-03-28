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
 *   Original:  function RD(A){if(A.isMcp===!0)return!0; ...}
 *   Patched:   function RD(A){if(A.name==="AskUserQuestion")return!1;if(A.isMcp===!0)return!0; ...}
 *
 * This runs as a postinstall hook — safe to re-run, idempotent.
 */

const fs = require('fs');
const path = require('path');

const SDK_CLI_PATH = path.resolve(
    __dirname,
    '../node_modules/@anthropic-ai/claude-agent-sdk/cli.js',
);

const ORIGINAL = 'function RD(A){if(A.isMcp===!0)return!0;';
const PATCHED = 'function RD(A){if(A.name==="AskUserQuestion")return!1;if(A.isMcp===!0)return!0;';

function patch() {
    if (!fs.existsSync(SDK_CLI_PATH)) {
        // SDK not installed yet — skip silently (first install, deps not ready)
        return;
    }

    const content = fs.readFileSync(SDK_CLI_PATH, 'utf8');

    if (content.includes(PATCHED)) {
        console.log('[patch-sdk] AskUserQuestion already patched — skipping');
        return;
    }

    if (!content.includes(ORIGINAL)) {
        console.warn(
            '[patch-sdk] WARNING: isDeferredTool signature changed — patch may need updating',
        );
        console.warn('[patch-sdk] Expected:', ORIGINAL);
        return;
    }

    const patched = content.replace(ORIGINAL, PATCHED);
    fs.writeFileSync(SDK_CLI_PATH, patched, 'utf8');
    console.log('[patch-sdk] Patched isDeferredTool — AskUserQuestion is now always available');
}

patch();
