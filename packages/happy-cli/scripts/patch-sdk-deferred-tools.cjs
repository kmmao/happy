/**
 * Patch Claude Code SDK to prevent AskUserQuestion from being deferred.
 *
 * Background:
 *   SDK 0.2.81..0.2.118 shipped the Claude Code runtime as minified JS
 *   (cli.js) inside the main package. That runtime gates AskUserQuestion
 *   behind a "deferred tools" mechanism (GrowthBook flag tengu_defer_all_bn4):
 *   the model must call ToolSearch to fetch the schema before invoking
 *   AskUserQuestion — the model skips that step and falls back to plain-text
 *   options, so the interactive step-based Q&A UI never appears.
 *
 *   This script patches the minified isDeferredTool() function to
 *   short-circuit for AskUserQuestion, keeping it always pre-loaded.
 *
 * SDK 0.2.119+:
 *   cli.js no longer ships in the main package — the runtime is split into
 *   platform-specific native binaries (@anthropic-ai/claude-agent-sdk-
 *   {platform}-{arch}). Binary patching is not viable, so on 0.2.119+ we
 *   fall back to disabling deferred-tool behavior entirely via env vars in
 *   the query adapter — see packages/happy-cli/src/claude/sdk/queryAdapter.ts
 *   (ENABLE_TOOL_SEARCH="auto:100" forces "standard" mode so every tool,
 *   including AskUserQuestion, is pre-loaded).
 *
 *   This script continues to be the preferred fix on any SDK version that
 *   still ships cli.js; it's an idempotent no-op when cli.js is absent.
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
