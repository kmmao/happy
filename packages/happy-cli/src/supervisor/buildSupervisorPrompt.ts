/**
 * Build the initial prompt for a supervisor analysis session.
 *
 * The session runs in **read-only mode** — the prompt explicitly forbids
 * file modifications. It instructs Claude to analyze the project against
 * configured dimensions and output a structured JSON report, then report
 * results back to the server via curl and exit.
 */

import {
  buildDimensionsSection,
  defaultEnabledDimensions,
  dimensionTemplates,
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
  /** Server URL for reporting results back. */
  readonly serverUrl: string;
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

  const reportUrl = `${options.serverUrl}/v1/projects/${options.projectId}/supervisor/runs/${options.runId}/status`;

  // Build dimension key list for progress reporting
  const dimKeys = (dims as readonly string[]).filter(
    (k) => dimensionTemplates[k] !== undefined,
  );
  const totalDimensions = dimKeys.length;
  const dimKeyList = dimKeys
    .map((k, i) => `${i + 1}. "${k}" → ${dimensionTemplates[k]!.title}`)
    .join("\n");

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
Analyze the project across these dimensions **in order**:

${buildDimensionsSection(dims)}

## Output Format
After your analysis, you MUST produce a JSON object with an \`actions\` array containing your findings:

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

## MANDATORY: Report Progress Per Dimension (CRITICAL)

After completing **each** dimension analysis, you MUST immediately report progress via curl.
The enabled dimensions for this run are (analyze them in this exact order):
${dimKeyList}

After finishing each dimension, run:
\`\`\`
curl -s -X POST "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"running","currentDimension":"<DIMENSION_KEY>","dimensionIndex":<INDEX>,"totalDimensions":${totalDimensions}}'
\`\`\`

Replace \`<DIMENSION_KEY>\` with the dimension key (e.g. "security") and \`<INDEX>\` with its 1-based index from the list above.
Do this for EVERY dimension, one by one, before moving to the next dimension.

## MANDATORY: Report Results (CRITICAL — do this AFTER your analysis)

After completing your analysis, you MUST execute the following two steps in order:

### Step 1: Report results to the server
Write your actions JSON to a temp file, then POST it to the server using curl.
Use the Bash tool to run this exact sequence:

\`\`\`
# Write the actions JSON to a temp file (replace the actions array with your actual findings)
cat > /tmp/supervisor-result-${options.runId}.json << 'SUPERVISOR_EOF'
{"status":"completed","actions":[... your actual actions array here ...]}
SUPERVISOR_EOF

# POST results to server
curl -s -X POST "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d @/tmp/supervisor-result-${options.runId}.json

# Cleanup
rm -f /tmp/supervisor-result-${options.runId}.json
\`\`\`

**Important**: The JSON body must contain \`"status": "completed"\` and the \`"actions"\` array with your findings. Use the HAPPY_SUPERVISOR_AUTH_TOKEN environment variable (already set) for authentication.

### Step 2: Exit the session
After successfully reporting results, send the text "/exit" to end this session.

If the curl command fails, report failure instead:
\`\`\`
curl -s -X POST "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"failed","errorMessage":"Failed to report results"}'
\`\`\`

Begin your analysis now.`;
}
