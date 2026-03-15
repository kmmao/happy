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
  /** JSON string: { knownCompetitors?: string, focusAreas?: string } */
  readonly researchParams?: string;
}

export function buildResearchPrompt(options: ResearchPromptOptions): string {
  const reportUrl = `${options.serverUrl}/v1/projects/${options.projectId}/supervisor/runs/${options.runId}/status`;

  let parsedParams: { knownCompetitors?: string; focusAreas?: string } = {};
  if (options.researchParams) {
    try {
      parsedParams = JSON.parse(options.researchParams);
    } catch {
      // ignore parse errors
    }
  }

  const competitorsSection = parsedParams.knownCompetitors?.trim()
    ? `
## Known Competitors (User-Provided)
The user has identified these competitors for comparison:

${parsedParams.knownCompetitors.trim()}

Include these in your analysis. You may also identify additional competitors.
`
    : "";

  const focusSection = parsedParams.focusAreas?.trim()
    ? `
## Focus Areas (User-Provided)
The user wants the analysis to focus on:

${parsedParams.focusAreas.trim()}
`
    : "";

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
${competitorsSection}${focusSection}
## Step 2: Competitor Analysis
Based on your knowledge, identify 3-5 similar products/tools in the same space.
For each competitor, analyze:
- Core features and unique selling points
- Target audience overlap
- Technology approach
- Pricing model (if known)
- Strengths and weaknesses relative to this project

## Step 3: Generate Report
Write a comprehensive Markdown report with these sections:

### Report Structure
1. **Project Overview** — Brief summary of what this project does
2. **Competitor Landscape** — Table listing identified competitors with key attributes
3. **Feature Matrix** — Markdown table comparing features across products (use checkmarks)
4. **Differentiation Analysis** — What makes this project unique vs competitors
5. **Gap Analysis** — Features competitors have that this project lacks
6. **Technology Comparison** — Tech stack differences and trade-offs
7. **Strategic Recommendations** — Prioritized list of features/improvements to develop

## Disclaimer
Add this at the end of the report:
> **Note**: This analysis is based on AI model knowledge (cutoff: early 2025). Market conditions and product features may have changed. Verify key findings with current data.

## MANDATORY: Report Progress (CRITICAL)

After understanding the project (Step 1), report progress:
\`\`\`
curl -s -X POST "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"running","currentDimension":"research","dimensionIndex":1,"totalDimensions":2}'
\`\`\`

## MANDATORY: Report Results (CRITICAL — do this AFTER your analysis)

### Step 1: Report results to the server
Write your report to a temp file, then POST it to the server using curl.
Use the Bash tool to run this exact sequence:

\`\`\`
# Write the report JSON to a temp file
# IMPORTANT: reportTitle should be a short title, reportContent is the full Markdown report
cat > /tmp/research-result-${options.runId}.json << 'RESEARCH_EOF'
{"status":"completed","reportTitle":"<Your Report Title>","reportContent":"<Full Markdown Report Content>"}
RESEARCH_EOF

# POST results to server
curl -s -X POST "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d @/tmp/research-result-${options.runId}.json

# Cleanup
rm -f /tmp/research-result-${options.runId}.json
\`\`\`

**Important**: The JSON body must contain \`"status": "completed"\`, \`"reportTitle"\`, and \`"reportContent"\` (the full Markdown report). Use the HAPPY_SUPERVISOR_AUTH_TOKEN environment variable (already set) for authentication.

Escape all special characters properly in the JSON. For newlines in reportContent, use \\n.

### Step 2: Exit the session
After successfully reporting results, send the text "/exit" to end this session.

If the curl command fails, report failure instead:
\`\`\`
curl -s -X POST "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"failed","errorMessage":"Failed to report research results"}'
\`\`\`

Begin your analysis now.`;
}
