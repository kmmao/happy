// Intercept setTimeout for the Claude Code SDK
const originalSetTimeout = global.setTimeout;

global.setTimeout = function(callback, delay, ...args) {
    // Just wrap and call the original setTimeout
    return originalSetTimeout(callback, delay, ...args);
};

// Preserve setTimeout properties
Object.defineProperty(global.setTimeout, 'name', { value: 'setTimeout' });
Object.defineProperty(global.setTimeout, 'length', { value: originalSetTimeout.length });

// Import global Claude Code CLI (CJS interop via createRequire)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { getClaudeCliPath, runClaudeCli } = require('./claude_version_utils.cjs');

runClaudeCli(getClaudeCliPath());
