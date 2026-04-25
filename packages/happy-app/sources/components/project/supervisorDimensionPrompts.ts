/**
 * Prompt content for each built-in supervisor analysis dimension.
 * Mirrors the CLI's dimensionTemplates.ts — used to display dimension
 * details in the settings UI when the user taps the ℹ icon.
 */

const builtInDimensionPrompts: Record<string, string> = {
    security: `• Run yarn audit / npm audit for known vulnerabilities
• Search for hardcoded secrets (API keys, passwords, tokens)
• Check for security anti-patterns (eval, innerHTML, SQL concatenation, path traversal)
• Look for missing input validation on user-facing endpoints
• Check CORS configuration — overly permissive origins or missing headers
• Verify auth tokens are not stored in localStorage or logs
• Look for missing rate limiting on sensitive endpoints
• Check that error responses don't leak stack traces or internal paths`,

    dependencies: `• Run yarn outdated / npm outdated to find stale packages
• Identify deprecated packages
• Check for major version gaps (≥ 2 major versions behind)
• Look for duplicate or conflicting package versions`,

    architecture: `• Read CLAUDE.md and check if the code follows its conventions
• Check indentation style consistency
• Verify i18n compliance (hardcoded user-visible strings)
• Check import patterns and file organization`,

    techDebt: `• Search for TODO/FIXME/HACK/XXX comments and assess severity
• Identify dead code (unused exports, unreachable branches)
• Look for copy-pasted code blocks that should be abstracted
• Check for overly complex functions (deeply nested, too many params)`,

    codeQuality: `• Run the project linter if configured (eslint, biome, etc.)
• Check TypeScript strict mode compliance
• Look for unhandled promise rejections and missing error handling
• Identify functions exceeding 50 lines or files exceeding 800 lines`,

    testCoverage: `• Run yarn test --coverage and check overall coverage %
• Identify core modules with no test files at all
• Look for tests that only assert trivial things
• Check that critical paths (auth, data mutations) have integration tests
• Verify test commands are configured and runnable
• Look for skipped tests (xit, xdescribe, test.skip) hiding real failures`,

    documentation: `• Check if README and CLAUDE.md are up-to-date with project structure
• Verify that public API functions have adequate documentation
• Look for misleading or outdated comments
• Check if CHANGELOG is maintained`,

    performance: `• Look for N+1 query patterns in database access code
• Identify missing indexes on frequently queried fields
• Check for synchronous blocking operations in async contexts
• Look for unbounded list operations (no pagination, no limit)
• Identify potential memory leaks (event listeners, growing caches)
• Check frontend bundle — heavy dependencies without tree-shaking
• Identify unnecessary re-renders (missing React.memo, unstable props)
• Look for images/assets loaded without lazy loading
• Check for expensive operations inside render functions or tight loops`,

    uiUx: `• Check for inconsistent spacing, padding, and alignment patterns
• Look for missing loading states, empty states, and error states
• Identify inaccessible elements (missing labels, low contrast, no keyboard nav)
• Check for hardcoded colors instead of theme tokens
• Look for missing touch feedback (pressable without visual response)
• Identify overly long text without truncation or wrapping
• Check for missing i18n in user-visible strings`,

    typeSafety: `• Search for \`any\` type usage in function signatures and API boundaries
• Look for unsafe type assertions (\`as SomeType\`) that bypass null checks
• Identify missing return types on exported functions
• Check for @ts-ignore / @ts-expect-error hiding real issues
• Look for implicit any from untyped third-party libraries
• Verify Zod or equivalent runtime validation at all external data boundaries
• Check for optional chaining (?.) gaps where runtime crashes can occur`,

    observability: `• Check if errors are logged with enough context (request ID, user ID, operation name)
• Look for silent error swallowing: catch {}, catch (e) { /* ignore */ }
• Identify missing structured logging (plain console.log instead of key-value pairs)
• Check that async jobs and scheduled tasks log start, end, and failure states
• Look for performance-critical paths with no timing instrumentation
• Verify that health check endpoints exist and return meaningful status
• Check if critical business events (signup, payment, auth failure) are logged`,

    apiDesign: `• Check REST endpoint naming — consistent plural nouns, no verbs in paths
• Verify HTTP method usage (GET reads, POST creates, PATCH partial updates, DELETE removal)
• Look for inconsistent error response formats across endpoints
• Check that all endpoints return appropriate HTTP status codes
• Identify missing pagination on list endpoints
• Look for breaking changes without versioning (removed fields, changed types)
• Check that request body validation is present on all mutation endpoints
• Verify authentication is applied consistently across all endpoints`,

    buildCI: `• Check if CI configuration exists (.github/workflows, .gitlab-ci.yml, etc.)
• Verify the build command completes without errors
• Look for type checking (tsc --noEmit) in the CI pipeline
• Check that tests are executed in CI — not just linting
• Identify overly long build times (missing caches for node_modules)
• Look for hardcoded environment values in build configs
• Check if deploy step requires manual approval for production
• Verify build scripts in package.json match what CI actually runs`,
};

/** Get the prompt detail text for a built-in dimension key. Returns null for unknown keys. */
export function getDimensionPrompt(key: string): string | null {
    return builtInDimensionPrompts[key] ?? null;
}
