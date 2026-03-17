/**
 * Build a prompt for a fix session.
 *
 * Unlike the analysis prompt (read-only), the fix prompt instructs Claude
 * to actually modify files to address a specific supervisor finding.
 * The fix runs in an isolated git worktree.
 *
 * Two strategies are supported:
 * - "direct": push directly to main (default) — rebase, test, ff-push
 * - "pr": push branch and create a pull request
 *
 * In direct mode, if rebase conflicts can't be resolved, tests fail, or
 * push is rejected, the agent automatically falls back to PR mode.
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
  readonly issueNumber?: number;
  readonly fixStrategy?: "direct" | "pr";
}

export function buildFixPrompt(options: FixPromptOptions): string {
  const strategy = options.fixStrategy ?? "direct";

  const suggestedFixSection = options.suggestedFix
    ? `
## Suggested Fix
${options.suggestedFix}
`
    : "";

  const reportUrl = `${options.serverUrl}/v1/projects/${options.projectId}/supervisor/actions/${options.actionId}/fix-status`;

  const processSection = strategy === "direct"
    ? buildDirectModeProcess(options, reportUrl)
    : buildPrModeProcess(options, reportUrl);

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

${processSection}

After reporting, send "/exit" to end this session.

Begin fixing now.`;
}

function buildDirectModeProcess(options: FixPromptOptions, reportUrl: string): string {
  const closesRef = options.issueNumber
    ? ` Closes #${options.issueNumber}.`
    : "";

  return `## Process (Direct Merge Mode)
1. Read the relevant files to understand the issue
2. Apply the fix with minimal changes
3. Run tests if available (\`npm test\`, \`yarn test\`, or similar)
4. Commit the fix with message: "fix: ${options.title}${closesRef}"
5. Rebase onto the latest base branch:
   \`\`\`
   git fetch origin ${options.parentBranch}
   git rebase origin/${options.parentBranch}
   \`\`\`
   If there are rebase conflicts, resolve them carefully. After resolving, continue with \`git rebase --continue\`.
6. Run tests AGAIN after rebase to verify the fix still works
7. Push directly to the base branch (fast-forward):
   \`\`\`
   git push origin ${options.branchName}:${options.parentBranch}
   \`\`\`

### Fallback to PR Mode
If ANY of these fail — rebase conflicts cannot be resolved, tests fail after rebase, or push is rejected — fall back to PR mode:
1. Abort the rebase if in progress: \`git rebase --abort\`
2. Reset to your commit: \`git checkout ${options.branchName}\`
3. Push your branch: \`git push -u origin ${options.branchName}\`
4. Create a PR: \`gh pr create --base "${options.parentBranch}" --head "${options.branchName}" --title "fix: ${options.title}" --body "${options.issueNumber ? `Closes #${options.issueNumber}\\n\\n` : ""}Automated fix for supervisor finding: ${options.title}"\`
5. Get the PR URL: \`PR_URL=$(gh pr view --json url -q .url 2>/dev/null || echo "")\`

## MANDATORY: Report Results (CRITICAL — do this AFTER your fix)

After completing (or failing) your fix, you MUST report back to the server using curl.

### On Success (direct push):
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"fixStatus":"completed"}'
\`\`\`

### On Success (fell back to PR):
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{\\"fixStatus\\":\\"completed\\",\\"issueUrl\\":\\"$PR_URL\\"}"
\`\`\`

### On Failure:
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"fixStatus":"failed"}'
\`\`\``;
}

function buildPrModeProcess(options: FixPromptOptions, reportUrl: string): string {
  const prBody = options.issueNumber
    ? `Closes #${options.issueNumber}\\n\\nAutomated fix for supervisor finding: ${options.title}`
    : `Automated fix for supervisor finding: ${options.title}`;

  return `## Process (Pull Request Mode)
1. Read the relevant files to understand the issue
2. Apply the fix with minimal changes
3. Run tests if available (\`npm test\`, \`yarn test\`, or similar)
4. Commit the fix with message: "fix: ${options.title}"
5. Sync with the latest base branch to avoid merge conflicts: git fetch origin ${options.parentBranch} && git rebase origin/${options.parentBranch} (resolve any conflicts if they arise)
6. Push your branch to the remote: git push -u origin ${options.branchName}
7. Create a pull request: gh pr create --base "${options.parentBranch}" --head "${options.branchName}" --title "fix: ${options.title}" --body "${prBody}"
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
\`\`\``;
}
