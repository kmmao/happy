/**
 * Build the initial prompt for a supervisor analysis session.
 *
 * The session runs in **read-only mode** — the prompt explicitly forbids
 * file modifications. It instructs Claude to analyze the project against
 * configured dimensions and output a structured JSON report.
 */

import {
  buildDimensionsSection,
  defaultEnabledDimensions,
  getEnabledCategories,
} from "./dimensionTemplates";

export interface SupervisorPromptOptions {
  readonly projectId: string;
  readonly runId: string;
  readonly repoPath: string;
  readonly trigger: string;
  readonly mode?: string;
  /** Enabled analysis dimension keys. Falls back to defaults if empty/omitted. */
  readonly dimensions?: readonly string[];
  /** Changed files (for incremental/push-triggered scans). */
  readonly changedFiles?: readonly string[];
  /** User-defined custom analysis rules (appended to prompt). */
  readonly customRules?: string;
}

export function buildSupervisorPrompt(
  options: SupervisorPromptOptions,
): string {
  const dims =
    options.dimensions && options.dimensions.length > 0
      ? options.dimensions
      : defaultEnabledDimensions;

  const autoModeSection = options.mode === "auto"
    ? `
## Auto Mode Notice
This analysis is running in **auto mode**. Your findings for critical/high severity
will be automatically acted upon (fix sessions triggered, PRs created).

- Provide detailed and actionable \`suggestedFix\` for every critical/high finding
- Be conservative: only flag truly actionable issues as critical/high
- **PR merge ALWAYS requires human approval** — this is a hardcoded constraint
`
    : "";

  const incrementalSection =
    options.changedFiles && options.changedFiles.length > 0
      ? `
## Incremental Scan
This is a **push-triggered incremental scan**. Focus your analysis on the
following changed files and their immediate dependents:

${options.changedFiles.map((f) => `- \`${f}\``).join("\n")}

You may still check project-wide concerns (yarn audit, outdated), but prioritize
findings related to these files.
`
      : "";

  const customRulesSection =
    options.customRules && options.customRules.trim().length > 0
      ? `
## Custom Analysis Rules
The project owner has defined the following additional analysis instructions:

${options.customRules.trim()}
`
      : "";

  const categories = getEnabledCategories(dims);
  const categoryUnion = categories.map((c) => `"${c}"`).join(" | ");

  return `You are a **Project Health Supervisor** running an automated analysis.

## Context
- Project ID: ${options.projectId}
- Run ID: ${options.runId}
- Trigger: ${options.trigger}
- Repository: ${options.repoPath}
${autoModeSection}${incrementalSection}${customRulesSection}## Rules (CRITICAL)
1. **DO NOT modify any files.** This is a read-only analysis session.
2. **DO NOT create commits, branches, or PRs.**
3. **DO NOT run destructive commands** (rm, git reset, etc.).
4. You MAY read files, run diagnostic commands (yarn audit, yarn outdated, grep, etc.).

## Analysis Dimensions
Analyze the project across these dimensions:

${buildDimensionsSection(dims)}

## Output Format
After your analysis, output a JSON block (and ONLY a JSON block) at the very end of your response, enclosed in \`\`\`json fences:

\`\`\`json
{
  "actions": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "category": ${categoryUnion},
      "title": "Short title of the finding",
      "description": "Detailed description of the issue",
      "suggestedFix": "How to fix this (optional)",
      "confidence": 0-100
    }
  ]
}
\`\`\`

## Confidence Score Guidelines
Rate how confident you are in the \`suggestedFix\` (0-100):
- **80-100**: Clear, mechanical fix (e.g., bump dependency version, add missing import)
- **50-79**: Likely correct but may need human judgment or broader context
- **0-49**: Uncertain — significant design decisions or trade-offs involved

## Severity Guidelines
- **critical**: Active security vulnerability (CVE >= 7.0), hardcoded secrets, data exposure
- **high**: Deprecated package with known issues, major version gap >= 2, consistent convention violations
- **medium**: Minor outdated packages, style inconsistencies, missing i18n
- **low**: Cosmetic issues, minor naming preferences

Focus on actionable findings. Do not report more than 10 findings per run.
Begin your analysis now.`;
}
