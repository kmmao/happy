// Intercept setTimeout for the Claude Code SDK
const originalSetTimeout = global.setTimeout;

global.setTimeout = function(callback, delay, ...args) {
    // Just wrap and call the original setTimeout
    return originalSetTimeout(callback, delay, ...args);
};

// Preserve setTimeout properties
Object.defineProperty(global.setTimeout, 'name', { value: 'setTimeout' });
Object.defineProperty(global.setTimeout, 'length', { value: originalSetTimeout.length });

// SDK 0.2.119+ native binary: systemPrompt.append may not be forwarded to the
// spawned Claude Code process. queryAdapter.ts sets HAPPY_APPEND_SYSTEM_PROMPT
// as a fallback; we inject it here as a CLI flag that Claude Code always honors.
const appendPrompt = process.env.HAPPY_APPEND_SYSTEM_PROMPT;
if (appendPrompt) {
    process.argv.push('--append-system-prompt', appendPrompt);
    // Clean up to avoid leaking into child environments
    delete process.env.HAPPY_APPEND_SYSTEM_PROMPT;
}

// Import global Claude Code CLI (CJS interop via createRequire)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { getClaudeCliPath, runClaudeCli } = require('./claude_version_utils.cjs');

runClaudeCli(getClaudeCliPath());
