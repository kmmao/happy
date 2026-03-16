/**
 * Build a prompt for a fix session.
 *
 * Unlike the analysis prompt (read-only), the fix prompt instructs Claude
 * to actually modify files to address a specific supervisor finding.
 * The fix runs in an isolated git worktree, pushes the branch, creates a PR,
 * then reports status back to the server via curl.
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
  readonly branchName: string;
  readonly parentBranch: string;
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

## Worktree
- Branch: ${options.branchName}
- Parent branch: ${options.parentBranch}

## Finding to Fix
**${options.title}**

${options.description}
${suggestedFixSection}
## Rules (CRITICAL)
1. **Fix ONLY the specific issue described above.** Do not refactor unrelated code.
2. **Make minimal, targeted changes.** Smaller diffs are better.
3. **Run existing tests after your fix** to ensure nothing breaks.
4. **Do NOT modify unrelated files.**

## Process
1. Read the relevant files to understand the issue
2. Apply the fix with minimal changes
3. Run tests if available (\`npm test\`, \`yarn test\`, or similar)
4. Commit the fix with message: "fix: ${options.title}"
5. Sync with the latest base branch to avoid merge conflicts: git fetch origin ${options.parentBranch} && git rebase origin/${options.parentBranch} (resolve any conflicts if they arise)
6. Push your branch to the remote: git push -u origin ${options.branchName}
7. Create a pull request: gh pr create --base "${options.parentBranch}" --head "${options.branchName}" --title "fix: ${options.title}" --body "Automated fix for supervisor finding: ${options.title}"
8. Get the PR URL for reporting: PR_URL=$(gh pr view --json url -q .url 2>/dev/null || echo "")

## MANDATORY: Report Results (CRITICAL — do this AFTER your fix)

After completing (or failing) your fix, you MUST report back to the server using curl.

### On Success:
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{\\"fixStatus\\":\\"completed\\",\\"issueUrl\\":\\"$PR_URL\\"}"
\`\`\`

If \`gh\` is not available or PR creation fails, still push the branch and report completed without issueUrl:
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
