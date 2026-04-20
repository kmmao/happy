/**
 * Build the initial prompt for a competitor research session.
 *
 * The session runs in **read-only mode** — reads project description files
 * (README, CLAUDE.md, package.json) and uses AI model knowledge to analyze
 * competitors, outputting a structured Markdown report.
 */

export interface ResearchPromptOptions {
  readonly projectId: string;
  readonly runId: string;
  readonly repoPath: string;
  readonly serverUrl: string;
  /** JSON string: { knownCompetitors?: string, focusAreas?: string, additionalNotes?: string, featureDirection?: string } */
  readonly researchParams?: string;
}

export function buildResearchPrompt(options: ResearchPromptOptions): string {
  const reportUrl = `${options.serverUrl}/v1/projects/${options.projectId}/supervisor/runs/${options.runId}/status`;

  let parsedParams: {
    knownCompetitors?: string;
    focusAreas?: string;
    additionalNotes?: string;
    featureDirection?: string;
  } = {};
  if (options.researchParams) {
    try {
      parsedParams = JSON.parse(options.researchParams);
    } catch {
      // ignore parse errors
    }
  }

  const featureDirection = parsedParams.featureDirection?.trim() ?? "";
  const isOpenSourceMode = featureDirection.length > 0;

  // Dimensions not meaningful when evaluating open-source libraries
  const OSS_IRRELEVANT_DIMS = new Set(["pricing", "funding", "positioning", "userFeedback"]);

  // Dimension labels for OSS evaluation (covers both user-selected and OSS-specific)
  const OSS_DIM_LABELS: Record<string, string> = {
    features: "Core capabilities and feature completeness",
    devExperience: "API design, documentation quality, ease of integration",
    techStack: "Tech stack alignment with this project",
    community: "GitHub stars, contributor count, issue responsiveness",
    license: "License type (MIT/Apache/GPL) — commercial use implications",
    maintenance: "Last commit date, release cadence, open issue backlog",
    bundleSize: "Bundle size / runtime performance overhead",
    stackCompatibility: "Compatibility with existing dependencies (no version conflicts)",
  };

  const competitorsSection = parsedParams.knownCompetitors?.trim()
    ? `
## Known Competitors / Reference Projects (User-Provided)
${parsedParams.knownCompetitors.trim()}

${isOpenSourceMode ? "Use these as additional reference points for comparison." : "Include these in your analysis. You may also identify additional competitors."}
`
    : "";

  // In OSS mode: filter out irrelevant dims, always append OSS-specific dims
  const effectiveFocusSection = (() => {
    if (!isOpenSourceMode) {
      return parsedParams.focusAreas?.trim()
        ? `
## Focus Areas (User-Provided)
The user wants the analysis to focus on:

${parsedParams.focusAreas.trim()}
`
        : "";
    }
    const userDims = (parsedParams.focusAreas ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const relevantUserDims = userDims.filter((d) => !OSS_IRRELEVANT_DIMS.has(d));
    const ossDims = ["license", "maintenance", "bundleSize", "stackCompatibility"];
    const effectiveDims = [...new Set([...relevantUserDims, ...ossDims])];
    return `
## Evaluation Dimensions for Open Source Libraries
Evaluate each candidate on these dimensions:

${effectiveDims
  .map((d) => `- **${d}**: ${OSS_DIM_LABELS[d] ?? d}`)
  .join("\n")}
`;
  })();

  const additionalNotesSection = parsedParams.additionalNotes?.trim()
    ? `
## Additional Context (User-Provided)
${parsedParams.additionalNotes.trim()}
`
    : "";

  const openSourceModeHeader = isOpenSourceMode
    ? `
## Mode: Open Source Discovery (PRIORITY)
The user wants to implement the following feature/direction:

> ${featureDirection}

**Skip standard competitor analysis. Your sole goal is finding the best open source library or project to implement this.**
`
    : "";

  const step2 = isOpenSourceMode
    ? `## Step 2: Open Source Candidate Discovery
Identify 5-8 open source libraries/projects that could implement the feature direction above.
For each candidate, evaluate all dimensions listed in the Evaluation Dimensions section.`
    : `## Step 2: Competitor Analysis
Based on your knowledge, identify 3-5 similar products/tools in the same space.
For each competitor, analyze:
- Core features and unique selling points
- Target audience overlap
- Technology approach
- Pricing model (if known)
- Strengths and weaknesses relative to this project`;

  const step3ReportStructure = isOpenSourceMode
    ? `### Report Structure
1. **Project Overview** — Brief summary of what this project does and its current tech stack
2. **§ Open Source Candidates** — Markdown table: | Library | Stars | License | Last Active | Bundle Size | Integration | Verdict |
3. **§ Recommendation**
   - **Primary**: best choice with reasoning
   - **Alternative**: runner-up and when to prefer it
   - **Avoid**: what to skip and why
4. **§ Implementation Path** — Step-by-step integration guide referencing actual file paths from Step 1
5. **§ Risks & Trade-offs** — Known gotchas, migration cost, long-term maintenance risk`
    : `### Report Structure
1. **Project Overview** — Brief summary of what this project does
2. **Competitor Landscape** — Table listing identified competitors with key attributes
3. **Feature Matrix** — Markdown table comparing features across products (use checkmarks)
4. **Differentiation Analysis** — What makes this project unique vs competitors
5. **Gap Analysis** — Features competitors have that this project lacks
6. **Technology Comparison** — Tech stack differences and trade-offs
7. **Strategic Recommendations** — Prioritized list of features/improvements to develop`;

  const step4Category = isOpenSourceMode ? "opensource-integration" : "research";

  return `You are a **Competitor Research Analyst** running a product analysis.

## Context
- Project ID: ${options.projectId}
- Run ID: ${options.runId}
- Repository: ${options.repoPath}

## Rules (CRITICAL)
1. **DO NOT modify any files.** This is a read-only analysis session.
2. **DO NOT create commits, branches, or PRs.**
3. **DO NOT run destructive commands** (rm, git reset, etc.).
4. You MAY read files to understand the project.

## Step 1: Understand the Project
Read the following files to understand what this project does:
- \`README.md\` (or \`readme.md\`)
- \`CLAUDE.md\`
- \`package.json\` (or \`Cargo.toml\`, \`pyproject.toml\`, \`go.mod\` — whichever exists)
- Any other top-level documentation files

Extract: project name, core purpose, target users, key features, tech stack.
${competitorsSection}${effectiveFocusSection}${additionalNotesSection}${openSourceModeHeader}
${step2}

## Step 3: Generate Report
Write a comprehensive Markdown report with these sections:

${step3ReportStructure}

## Step 4: Verify & Extract Actionable Items
After writing the report, extract **concrete, implementable tasks** — but **verify each one against the actual codebase first**.

### 4a: Verify before creating actions
For each potential action from Gap Analysis and Strategic Recommendations:
1. **Search the codebase** (grep, read files) to check if this feature/capability already exists
2. If it already exists → **skip it** (do not create an action)
3. If it partially exists → note what's missing and create an action for the gap only
4. If it doesn't exist → create the action

This verification is critical to avoid suggesting features the project already has.

### 4b: Structure each action
For each verified actionable item, determine:
- **severity**: "critical" | "high" | "medium" | "low" — based on strategic priority
- **category**: use "${step4Category}" as the category for all actions derived from this analysis
- **title**: short, actionable title (e.g., "Add team collaboration with shared sessions")
- **description**: what needs to be built and why (reference competitor evidence). If partially exists, describe what's missing.
- **suggestedFix**: concrete implementation approach for this codebase, referencing actual file paths and modules you found during verification
- **confidence**: 0-100, how confident you are this is worth implementing (lower if you couldn't fully verify)

Rules for actions:
- **NEVER suggest features that already exist in the codebase**
- Only include items that are **concretely implementable** (not vague strategy)
- High priority items from the report → severity "high" or "critical"
- Medium priority → "medium", Low priority → "low"
- Maximum 10 actions — focus on the most impactful ones
- Each action should be a single, scoped task (not a multi-month initiative)
- suggestedFix should reference real file paths from the codebase

## Disclaimer
Add this at the end of the report:
> **Note**: This analysis is based on AI model knowledge (cutoff: early 2025). Market conditions and product features may have changed. Verify key findings with current data.

## MANDATORY: Report Progress (CRITICAL)

After understanding the project (Step 1), report progress:
\`\`\`
curl -s -X POST "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_CALLBACK_TOKEN" \\
  -H "X-Happy-Machine-Id: $HAPPY_SUPERVISOR_MACHINE_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"running","currentDimension":"research","dimensionIndex":1,"totalDimensions":2}'
\`\`\`

## MANDATORY: Report Results (CRITICAL — do this AFTER your analysis)

### Step 1: Report results to the server
Write your report AND actions to a temp file, then POST it to the server using curl.
Use the Bash tool to run this exact sequence:

\`\`\`
# Write the report JSON to a temp file
# IMPORTANT: Include both reportContent (full Markdown) AND actions (structured items from Step 4)
cat > /tmp/research-result-${options.runId}.json << 'RESEARCH_EOF'
{
  "status": "completed",
  "reportTitle": "<Your Report Title>",
  "reportContent": "<Full Markdown Report Content>",
  "actions": [
    {
      "severity": "high",
      "category": "research",
      "title": "<Short actionable title>",
      "description": "<What to build and why>",
      "suggestedFix": "<Concrete implementation approach>",
      "confidence": 80
    }
  ]
}
RESEARCH_EOF

# POST results to server
curl -s -X POST "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_CALLBACK_TOKEN" \\
  -H "X-Happy-Machine-Id: $HAPPY_SUPERVISOR_MACHINE_ID" \\
  -H "Content-Type: application/json" \\
  -d @/tmp/research-result-${options.runId}.json

# Cleanup
rm -f /tmp/research-result-${options.runId}.json
\`\`\`

**Important**: The JSON body must contain:
- \`"status": "completed"\`
- \`"reportTitle"\` — short title for the report
- \`"reportContent"\` — full Markdown report
- \`"actions"\` — array of actionable items extracted in Step 4 (max 10)

Use the HAPPY_SUPERVISOR_CALLBACK_TOKEN environment variable (already set) for authentication.
Escape all special characters properly in the JSON. For newlines in reportContent, use \\n.

After reporting, stop and wait. Do not send "/exit" — the user may want to inspect or continue this session.

If the curl command fails, report failure instead:
\`\`\`
curl -s -X POST "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_CALLBACK_TOKEN" \\
  -H "X-Happy-Machine-Id: $HAPPY_SUPERVISOR_MACHINE_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"failed","errorMessage":"Failed to report research results"}'
\`\`\`

Begin your analysis now.`;
}
