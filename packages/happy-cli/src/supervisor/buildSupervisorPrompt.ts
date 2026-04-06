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
  /** Project narrative / vision (World Model Phase 0). */
  readonly narrative?: string;
  /** Project laws JSON array (World Model Phase 0). [{id, category, description, enabled, severity}] */
  readonly laws?: string;
  /** Existing pending/approved actions to avoid duplicating. */
  readonly existingActions?: ReadonlyArray<{
    category: string;
    title: string;
    severity: string;
    approval: string;
    fixStatus: string | null;
  }>;
  /** Server URL for reporting results back. */
  readonly serverUrl: string;
  /** Max findings per run. 0 or negative = unlimited. Default: 10. */
  readonly maxFindings?: number;
}

export function buildSupervisorPrompt(
  options: SupervisorPromptOptions,
): string {
  const dims =
    options.dimensions && options.dimensions.length > 0
      ? options.dimensions
      : defaultEnabledDimensions;

  const maxFindings = options.maxFindings;
  const maxFindingsLine = maxFindings != null && maxFindings > 0
    ? `Focus on actionable findings. Do not report more than ${maxFindings} findings per run.`
    : "Focus on actionable findings. Report all findings you discover.";

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

  const worldModelSection = buildWorldModelSection(options.narrative, options.laws);

  const existingActionsSection = buildExistingActionsSection(options.existingActions);

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
${autoModeSection}${incrementalSection}${worldModelSection}${customRulesSection}${existingActionsSection}## Rules (CRITICAL)
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

## Description Accuracy (CRITICAL)
- In the \`description\` field, only reference file paths, line numbers, and code patterns that you have **actually verified** by reading the file.
- **NEVER guess line numbers.** If you haven't read the file, describe the issue without specific line references.
- The description must be accurate enough that another AI agent can locate and fix the issue by searching the codebase.

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

${maxFindingsLine}

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

${buildDecisionReportingSection(options.serverUrl, options.projectId)}
Begin your analysis now.`;
}

function buildExistingActionsSection(
  actions?: ReadonlyArray<{
    category: string;
    title: string;
    severity: string;
    approval: string;
    fixStatus: string | null;
  }>,
): string {
  if (!actions || actions.length === 0) return "";

  const rows = actions.map((a, i) => {
    const status = a.fixStatus
      ? `${a.approval} (fix ${a.fixStatus})`
      : a.approval;
    return `| ${i + 1} | ${a.severity} | ${a.category} | ${a.title} | ${status} |`;
  });

  const hasIgnored = actions.some((a) => a.approval === "ignored");
  const hasSkipped = actions.some((a) => a.approval === "skipped");

  let guidance = `**CRITICAL DEDUPLICATION RULES:**
1. **DO NOT report any issue that is semantically similar** to an existing finding below, even if:
   - You use different wording or phrasing
   - You reference a different file but the same class of issue (e.g., "X file too large" when "Y file too large" already exists)
   - You add more specific detail to a general finding that already exists
   - You report a subset or superset of an existing finding
2. Before adding ANY action, mentally check: "Does an existing finding below already cover this concern?" If yes, SKIP it.
3. Prefer reporting **zero** new actions over reporting duplicates. Quality over quantity.`;

  if (hasIgnored || hasSkipped) {
    const parts: string[] = [];
    if (hasIgnored) {
      parts.push(`- **ignored**: The user permanently dismissed these. DO NOT report them again.`);
    }
    if (hasSkipped) {
      parts.push(`- **skipped**: The user temporarily skipped these. You SHOULD re-report them if the issue still exists, so they resurface for review.`);
    }
    guidance += `

Status-specific rules:
${parts.join("\n")}
- **pending** / **approved**: DO NOT report these again, not even with different wording.`;
  }

  return `
## Known Existing Findings (${actions.length} items)
The following issues have been identified in previous analysis runs.
${guidance}

| # | Severity | Category | Title | Status |
|---|----------|----------|-------|--------|
${rows.join("\n")}

**Remember**: If an existing finding says "X file is too large" and you find "Y file is too large", that is the SAME CLASS of issue — do NOT report it separately. Only report genuinely novel issues that represent a different category of concern.
`;
}

interface Law {
  id: string;
  category: string;
  description: string;
  enabled: boolean;
  severity: string;
}

const severityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function buildWorldModelSection(
  narrative: string | undefined,
  lawsJson: string | undefined,
): string {
  const parts: string[] = [];

  if (narrative && narrative.trim().length > 0) {
    parts.push(`
## Project Narrative
${narrative.trim()}
`);
  }

  if (lawsJson && lawsJson.trim().length > 0) {
    let laws: Law[];
    try {
      laws = JSON.parse(lawsJson) as Law[];
    } catch {
      return parts.join("");
    }

    const enabledLaws = laws
      .filter((l) => l.enabled)
      .sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));

    if (enabledLaws.length > 0) {
      const rows = enabledLaws.map(
        (l, i) => `| ${i + 1} | ${l.category} | ${l.severity} | ${l.description} |`,
      );

      parts.push(`
## Project Laws (MANDATORY — check each law)
The project owner has defined the following laws. You MUST check each enabled law
and report a finding for any violation. Only report clear, evidence-based violations.

| # | Category | Severity | Law |
|---|----------|----------|-----|
${rows.join("\n")}

For each law violated, create a finding with:
- category: the law's category (if it matches an enabled dimension) or the closest dimension
- severity: the law's severity
- title: "[Law Violation] <short description>"
- description: What violates this law, where, and evidence you found
`);
    }
  }

  return parts.join("");
}

function buildDecisionReportingSection(serverUrl: string, projectId: string): string {
  const decisionUrl = `${serverUrl}/v1/projects/${projectId}/decisions`;
  const matchUrl = `${serverUrl}/v1/projects/${projectId}/decisions/match`;

  return `
## Decision Reporting (Optional)

If you encounter a situation where:
- Multiple equally valid approaches exist and the choice requires human judgment
- The decision impacts project architecture, security policy, or direction
- You are uncertain about trade-offs between options

**First**, check if a precedent exists:
\`\`\`
curl -s "${matchUrl}?precedentKey=<KEY>" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN"
\`\`\`

If the response contains \`"matched": true\`, follow the precedent's \`chosenOption\` and do NOT report a new decision.

If no precedent found (\`"matched": false\`), report the decision:
\`\`\`
curl -s -X POST "${decisionUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"question":"<describe the decision>","options":[{"id":"a","description":"Option A","pros":"...","cons":"..."},{"id":"b","description":"Option B","pros":"...","cons":"..."}],"precedentKey":"<category-key>"}'
\`\`\`

Then **continue with your best judgment** — do NOT wait for a response. The project owner will adjudicate later, and the result becomes a precedent for future runs.
`;
}
