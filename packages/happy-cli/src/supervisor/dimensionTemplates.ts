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
- Search for hardcoded secrets (API keys, passwords, tokens)
- Check for common security anti-patterns (eval, innerHTML, SQL concatenation)
- Look for missing input validation on user-facing endpoints`,
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
    prompt: `- Check if test files exist for core modules
- Identify critical paths without test coverage
- Look for test files that only test trivial cases
- Verify test commands are configured and runnable`,
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
- Identify potential memory leaks (event listeners not cleaned up, growing caches)`,
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
