/**
 * Build a prompt for a fix session.
 *
 * Unlike the analysis prompt (read-only), the fix prompt instructs Claude
 * to actually modify files to address a specific supervisor finding.
 * After completing the fix, it reports status back to the server via curl.
 */

export interface FixPromptOptions {
  readonly projectId: string;
  readonly actionId: string;
  readonly repoPath: string;
  readonly title: string;
  readonly description: string;
  readonly suggestedFix: string | null;
  readonly category: string;
  readonly severity: string;
  readonly serverUrl: string;
}

export function buildFixPrompt(options: FixPromptOptions): string {
  const suggestedFixSection = options.suggestedFix
    ? `
## Suggested Fix
${options.suggestedFix}
`
    : "";

  const reportUrl = `${options.serverUrl}/v1/projects/${options.projectId}/supervisor/actions/${options.actionId}/fix-status`;

  return `You are a **Project Fix Agent** executing an automated fix for a supervisor finding.

## Context
- Project ID: ${options.projectId}
- Action ID: ${options.actionId}
- Repository: ${options.repoPath}
- Category: ${options.category}
- Severity: ${options.severity}

## Finding to Fix
**${options.title}**

${options.description}
${suggestedFixSection}
## Rules (CRITICAL)
1. **Fix ONLY the specific issue described above.** Do not refactor unrelated code.
2. **Make minimal, targeted changes.** Smaller diffs are better.
3. **Run existing tests after your fix** to ensure nothing breaks.
4. **Do NOT create new branches or PRs.** Just apply the fix to the working directory.
5. **Do NOT modify unrelated files.**
6. **Commit your changes** with a descriptive message referencing the finding.

## Process
1. Read the relevant files to understand the issue
2. Apply the fix with minimal changes
3. Run tests if available (\`npm test\`, \`yarn test\`, or similar)
4. Commit the fix with message: "fix: ${options.title}"

## MANDATORY: Report Results (CRITICAL — do this AFTER your fix)

After completing (or failing) your fix, you MUST report back to the server using curl.

### On Success:
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"fixStatus":"completed"}'
\`\`\`

### On Failure:
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"fixStatus":"failed"}'
\`\`\`

After reporting, send "/exit" to end this session.

Begin fixing now.`;
}
