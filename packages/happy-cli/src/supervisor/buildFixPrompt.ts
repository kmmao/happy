/**
 * Build a prompt for a fix session.
 *
 * Unlike the analysis prompt (read-only), the fix prompt instructs Claude
 * to actually modify files to address a specific supervisor finding.
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
}

export function buildFixPrompt(options: FixPromptOptions): string {
  const suggestedFixSection = options.suggestedFix
    ? `
## Suggested Fix
${options.suggestedFix}
`
    : "";

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

## Output Format
After completing the fix, output a JSON block at the very end of your response:

\`\`\`json
{
  "status": "completed" | "failed",
  "filesChanged": ["path/to/file1.ts", "path/to/file2.ts"],
  "testsPassed": true | false | null,
  "summary": "Brief description of what was changed"
}
\`\`\`

Begin fixing now.`;
}
