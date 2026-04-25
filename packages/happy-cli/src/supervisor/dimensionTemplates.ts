/**
 * Dimension-specific prompt templates for supervisor analysis.
 *
 * Each dimension provides instructions for what to check and how to report
 * findings. The buildSupervisorPrompt function assembles the final prompt
 * from whichever dimensions are enabled in the project config.
 */

export interface DimensionTemplate {
  readonly key: string;
  readonly title: string;
  readonly category: string;
  readonly prompt: string;
}

/**
 * All available analysis dimensions.
 * Order determines the numbering in the final prompt.
 */
export const dimensionTemplates: Record<string, DimensionTemplate> = {
  security: {
    key: "security",
    title: "Security",
    category: "security",
    prompt: `- Run \`yarn audit\` or \`npm audit\` to check for known vulnerabilities
- Search for hardcoded secrets (API keys, passwords, tokens) using grep patterns
- Check for common security anti-patterns (eval, innerHTML, SQL concatenation, path traversal)
- Look for missing input validation on user-facing endpoints
- Check CORS configuration — overly permissive origins or missing headers
- Verify auth tokens/session credentials are not stored in localStorage or logs
- Look for missing rate limiting on sensitive endpoints (auth, password reset, upload)
- Check that error responses don't leak stack traces or internal paths`,
  },

  dependencies: {
    key: "dependencies",
    title: "Dependencies",
    category: "dependencies",
    prompt: `- Run \`yarn outdated\` or \`npm outdated\` to find stale packages
- Identify deprecated packages
- Check for major version gaps (>= 2 major versions behind)
- Look for duplicate or conflicting package versions`,
  },

  architecture: {
    key: "architecture",
    title: "Architecture Consistency",
    category: "architecture",
    prompt: `- Read CLAUDE.md and check if the code follows its conventions
- Check indentation style consistency
- Verify i18n compliance (hardcoded user-visible strings)
- Check import patterns and file organization`,
  },

  techDebt: {
    key: "techDebt",
    title: "Technical Debt",
    category: "tech-debt",
    prompt: `- Search for TODO/FIXME/HACK/XXX comments and assess severity
- Identify dead code (unused exports, unreachable branches)
- Look for copy-pasted code blocks that should be abstracted
- Check for overly complex functions (deeply nested, too many params)`,
  },

  codeQuality: {
    key: "codeQuality",
    title: "Code Quality",
    category: "code-quality",
    prompt: `- Run the project linter if configured (eslint, biome, etc.)
- Check TypeScript strict mode compliance
- Look for unhandled promise rejections and missing error handling
- Identify functions exceeding 50 lines or files exceeding 800 lines`,
  },

  testCoverage: {
    key: "testCoverage",
    title: "Test Coverage",
    category: "test-coverage",
    prompt: `- Run \`yarn test --coverage\` or \`npx vitest run --coverage\` and check overall coverage %
- Identify core modules (business logic, API handlers, auth) that have no test files at all
- Look for tests that only assert trivial things (snapshot tests, empty assertions)
- Check that critical paths (auth flows, payment logic, data mutations) have integration tests
- Verify test commands are configured in package.json and runnable
- Look for skipped or disabled tests (\`xit\`, \`xdescribe\`, \`test.skip\`) that hide real failures`,
  },

  documentation: {
    key: "documentation",
    title: "Documentation",
    category: "documentation",
    prompt: `- Check if README and CLAUDE.md are up-to-date with actual project structure
- Verify that public API functions have adequate documentation
- Look for misleading or outdated comments
- Check if CHANGELOG is maintained`,
  },

  performance: {
    key: "performance",
    title: "Performance",
    category: "performance",
    prompt: `- Look for N+1 query patterns in database access code
- Identify missing indexes on frequently queried fields
- Check for synchronous blocking operations in async contexts
- Look for unbounded list operations (no pagination, no limit)
- Identify potential memory leaks (event listeners not cleaned up, growing caches)
- Check frontend bundle size — look for heavy dependencies imported without tree-shaking
- Identify unnecessary re-renders (missing React.memo, unstable object/array literals in props)
- Look for images or assets loaded without lazy loading or size optimization
- Check for expensive operations inside render functions or tight loops`,
  },

  uiUx: {
    key: "uiUx",
    title: "UI/UX",
    category: "ui-ux",
    prompt: `- Check for inconsistent spacing, padding, and alignment patterns
- Look for missing loading states, empty states, and error states
- Identify inaccessible elements (missing labels, low contrast, no keyboard nav)
- Check for hardcoded colors instead of theme tokens
- Look for missing touch feedback (pressable without visual response)
- Identify overly long text without truncation or wrapping
- Check for missing i18n in user-visible strings`,
  },

  typeSafety: {
    key: "typeSafety",
    title: "Type Safety",
    category: "type-safety",
    prompt: `- Search for \`any\` type usage in non-test TypeScript files — especially in function signatures and API boundaries
- Look for unsafe type assertions (\`as SomeType\`) that bypass null/undefined checks
- Identify missing return types on exported functions
- Check for \`@ts-ignore\` and \`@ts-expect-error\` comments — assess if they hide real issues
- Look for implicit \`any\` from untyped third-party libraries without \`@types\` packages
- Verify that Zod or equivalent runtime validation is used at all external data boundaries (API responses, user input)
- Check for optional chaining (\`?.\`) gaps where runtime crashes can occur`,
  },

  observability: {
    key: "observability",
    title: "Observability",
    category: "observability",
    prompt: `- Check if errors are logged with enough context (request ID, user ID, operation name) — not just the error message
- Look for silent error swallowing: \`catch {}\`, \`catch (e) { /* ignore */ }\`
- Identify missing structured logging — plain \`console.log\` strings instead of key-value pairs
- Check that async background jobs and scheduled tasks log their start, end, and failure states
- Look for performance-critical paths (DB queries, external API calls) that have no timing instrumentation
- Verify that health check endpoints exist and return meaningful status
- Check if critical business events (user signup, payment, auth failure) are logged for auditing`,
  },

  apiDesign: {
    key: "apiDesign",
    title: "API Design",
    category: "api-design",
    prompt: `- Check REST endpoint naming — consistent plural nouns, no verbs in paths
- Verify HTTP method usage is correct (GET for reads, POST for creates, PATCH for partial updates, DELETE for removal)
- Look for inconsistent error response formats across endpoints — should use a single envelope shape
- Check that all endpoints return appropriate HTTP status codes (not just 200 for errors)
- Identify missing pagination on list endpoints that could return unbounded results
- Look for breaking changes in existing endpoints (removed fields, changed types) without versioning
- Check that request body validation is present on all mutation endpoints
- Verify that API authentication is applied consistently — no accidentally public endpoints`,
  },

  buildCI: {
    key: "buildCI",
    title: "Build & CI",
    category: "build-ci",
    prompt: `- Check if CI configuration file exists (.github/workflows, .gitlab-ci.yml, etc.) and runs on PRs
- Verify the build command completes without warnings being treated as errors
- Look for \`tsc --noEmit\` or equivalent type checking in the CI pipeline
- Check that tests are executed in CI — not just linting
- Identify overly long build times (check for missing caches for node_modules, build artifacts)
- Look for hardcoded environment-specific values in build configs that break other environments
- Check if the CI pipeline has a deploy step and whether it requires manual approval for production
- Verify that build scripts in package.json are consistent with what CI actually runs`,
  },
};

/**
 * Default dimensions enabled when no config is provided.
 */
export const defaultEnabledDimensions = [
  "security",
  "dependencies",
  "architecture",
] as const;

/**
 * Build the "Analysis Dimensions" section from enabled dimension keys.
 */
export function buildDimensionsSection(
  enabledKeys: readonly string[],
): string {
  const sections: string[] = [];
  let index = 1;

  for (const key of enabledKeys) {
    const template = dimensionTemplates[key];
    if (!template) continue;

    sections.push(`### ${index}. ${template.title}\n${template.prompt}`);
    index++;
  }

  return sections.join("\n\n");
}

/**
 * Get valid category values from enabled dimensions (for JSON output format).
 */
export function getEnabledCategories(
  enabledKeys: readonly string[],
): string[] {
  return enabledKeys
    .map((key) => dimensionTemplates[key]?.category)
    .filter((c): c is string => c !== undefined);
}
