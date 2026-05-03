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
  readonly fixMode?: "fix" | "analyze-first";
  readonly analyzeAutoFix?: boolean;
  /** Contents of .happy/CONTEXT.md — project-level context so the fix agent knows project constraints */
  readonly contextMd?: string;
}

export function buildFixPrompt(options: FixPromptOptions): string {
  const strategy = options.fixStrategy ?? "direct";
  const isAnalyzeFirst = options.fixMode === "analyze-first";

  const suggestedFixSection = options.suggestedFix
    ? `
## Suggested Fix
${options.suggestedFix}
`
    : "";

  const projectContextSection = options.contextMd?.trim()
    ? `
## Project Context (.happy/CONTEXT.md)
The following is the project-level context defined by the user. Use it to understand
project goals, constraints, and coding conventions before making any changes:

${options.contextMd.trim()}
`
    : "";

  const reportUrl = `${options.serverUrl}/v1/projects/${options.projectId}/supervisor/actions/${options.actionId}/fix-status`;

  if (isAnalyzeFirst) {
    return buildAnalyzeFirstPrompt(options, suggestedFixSection, projectContextSection, reportUrl, strategy);
  }

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
${projectContextSection}
## Worktree
- Branch: ${options.branchName}
- Parent branch: ${options.parentBranch}

## Finding to Fix
**${options.title}**

${options.description}
${suggestedFixSection}
## Rules (CRITICAL)
1. **Address ONLY the specific issue described above.** Do not touch unrelated code.
2. **For bug fixes**: make minimal, targeted changes. Smaller diffs are better. For new features or enhancements: implement the full solution as described — larger diffs are expected and acceptable.
3. **Run existing tests after your changes** to ensure nothing breaks.
4. **Do NOT modify unrelated files.**
5. **Verify before acting**: The finding description may contain inaccurate line numbers or code snippets. Always search the actual codebase first. If the described code pattern does not exist AND this is clearly a bug fix (not a new feature), report the fix as **failed** — do NOT attempt to fix something that isn't there. For new features, the code not existing yet is expected — proceed with implementation.
6. **If the finding is a false positive** (the described bug does not actually exist in the code), report \`{"fixStatus":"failed"}\` immediately. Do not apply this rule to new feature requests — those never have pre-existing code.
7. **If this task requires substantial new development** (new feature, new module, significant enhancement): you are fully authorized to implement it. Use PR mode (push a branch and create a PR) rather than direct push. Do NOT self-abort because the scope seems large — implement the solution and let the PR review process handle it.

${processSection}

After reporting, send "/exit" to end this session.

Begin fixing now.`;
}

function buildAnalyzeFirstPrompt(
  options: FixPromptOptions,
  suggestedFixSection: string,
  projectContextSection: string,
  reportUrl: string,
  fixStrategy: "direct" | "pr",
): string {
  const autoFix = options.analyzeAutoFix === true;

  const afterAnalysisSection = autoFix
    ? `## After Analysis: Auto-Fix (ENABLED)

If your analysis concludes the issue is real and the fix is feasible (Recommendation = FIX):
1. **Proceed to fix the issue** with minimal, targeted changes
2. Run existing tests to ensure nothing breaks
3. Commit: "fix: ${options.title}"
4. ${fixStrategy === "direct"
      ? `Push to base branch: git fetch origin ${options.parentBranch} && git rebase origin/${options.parentBranch} && git push origin ${options.branchName}:${options.parentBranch}`
      : `Push branch and create PR: git push -u origin ${options.branchName} && gh pr create --base "${options.parentBranch}" --head "${options.branchName}" --title "fix: ${options.title}" --fill`}
5. Report as completed:
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_CALLBACK_TOKEN" \\
  -H "X-Happy-Machine-Id: $HAPPY_SUPERVISOR_MACHINE_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"fixStatus":"completed"}'
\`\`\`

If your analysis concludes the issue should NOT be fixed (Recommendation = SKIP or IGNORE):
- **Do NOT modify any code**
- Report as analyzed:
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_CALLBACK_TOKEN" \\
  -H "X-Happy-Machine-Id: $HAPPY_SUPERVISOR_MACHINE_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"fixStatus":"analyzed"}'
\`\`\``
    : `## MANDATORY: Report Results (CRITICAL — do this AFTER your analysis)

**Do NOT modify any code.** Your job is to investigate and report only.

After completing your analysis, you MUST report back to the server.

### Report as analyzed:
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_CALLBACK_TOKEN" \\
  -H "X-Happy-Machine-Id: $HAPPY_SUPERVISOR_MACHINE_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"fixStatus":"analyzed"}'
\`\`\``;

  return `You are a **Project Analysis Agent** performing a deep-dive analysis on a supervisor finding.

## Context
- Project ID: ${options.projectId}
- Action ID: ${options.actionId}
- Repository: ${options.repoPath}
- Category: ${options.category}
- Severity: ${options.severity}
${projectContextSection}
## Worktree
- Branch: ${options.branchName}
- Parent branch: ${options.parentBranch}

## Finding to Analyze
**${options.title}**

${options.description}
${suggestedFixSection}
## Your Task

Perform a thorough analysis of this finding.

### Analysis Steps
1. **Verify the issue exists**: Search the actual codebase for the described problem. Check if the code patterns, file paths, and line numbers mentioned are accurate.
2. **Assess severity**: Is the reported severity (${options.severity}) appropriate? Would you rate it differently?
3. **Evaluate the suggested fix**: If a fix was suggested, is it feasible? Would it introduce regressions? Are there better alternatives?
4. **Impact analysis**: What is the blast radius of this issue? What other parts of the codebase are affected?
5. **Risk assessment**: What are the risks of fixing vs. not fixing this issue?

### Output Format

Write a clear, structured analysis report with these sections:

**1. Issue Verification**: Does the issue actually exist? (YES / NO / PARTIALLY)
**2. Severity Assessment**: Is the severity accurate? (CONFIRMED / OVERRATED / UNDERRATED)
**3. Fix Feasibility**: Is the suggested fix viable? (VIABLE / NEEDS MODIFICATION / NOT VIABLE)
**4. Recommendation**: What should be done? (FIX / SKIP / IGNORE) with clear reasoning.
**5. Implementation Notes**: If recommending FIX, describe the approach and any caveats.

${afterAnalysisSection}

After reporting, send "/exit" to end this session.

Begin analysis now.`;
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
5. Push to base branch with **retry loop** (up to 3 attempts):

   For each attempt (1, 2, 3):
   a. Fetch latest: \`git fetch origin ${options.parentBranch}\`
   b. Rebase: \`git rebase origin/${options.parentBranch}\`
      - If rebase conflicts **cannot be resolved**: run \`git rebase --abort\`, then **stop retrying** and fall back to PR mode
   c. Run tests again to verify the fix still works after rebase
      - If tests **fail**: **stop retrying** and fall back to PR mode
   d. Push: \`git push origin ${options.branchName}:${options.parentBranch}\`
      - If push **succeeds**: report success and exit
      - If push is **rejected** (non-fast-forward): this means another commit landed on ${options.parentBranch} while you were rebasing — **loop back** to step (a) for the next attempt

   After 3 failed push attempts, fall back to PR mode.

### Fallback to PR Mode
Only fall back if: rebase conflicts cannot be resolved, tests fail after rebase, or push is still rejected after 3 attempts.

**If rebase conflicts cannot be resolved or tests fail:**
1. Abort the rebase if in progress: \`git rebase --abort\`
2. You are now back on \`${options.branchName}\` with your original fix commit
3. Push your branch: \`git push -u origin ${options.branchName}\`

**If push is still rejected after 3 attempts** (rebase succeeded, tests passed, but push keeps failing):
1. Do NOT abort — your branch already has the latest rebase result
2. Push your branch: \`git push -u origin ${options.branchName}\`

**Then create the PR:**
1. \`gh pr create --base "${options.parentBranch}" --head "${options.branchName}" --title "fix: ${options.title}" --body "${options.issueNumber ? `Closes #${options.issueNumber}\\n\\n` : ""}Automated fix for supervisor finding: ${options.title}"\`
2. Get the PR URL: \`PR_URL=$(gh pr view --json url -q .url 2>/dev/null || echo "")\`

## MANDATORY: Report Results (CRITICAL — do this AFTER your fix)

After completing (or failing) your fix, you MUST report back to the server using curl.

### On Success (direct push):
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_CALLBACK_TOKEN" \\
  -H "X-Happy-Machine-Id: $HAPPY_SUPERVISOR_MACHINE_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"fixStatus":"completed"}'
\`\`\`

### On Success (fell back to PR):
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_CALLBACK_TOKEN" \\
  -H "X-Happy-Machine-Id: $HAPPY_SUPERVISOR_MACHINE_ID" \\
  -H "Content-Type: application/json" \\
  -d "{\\"fixStatus\\":\\"completed\\",\\"issueUrl\\":\\"$PR_URL\\"}"
\`\`\`

### On Failure:
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_CALLBACK_TOKEN" \\
  -H "X-Happy-Machine-Id: $HAPPY_SUPERVISOR_MACHINE_ID" \\
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
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_CALLBACK_TOKEN" \\
  -H "X-Happy-Machine-Id: $HAPPY_SUPERVISOR_MACHINE_ID" \\
  -H "Content-Type: application/json" \\
  -d "{\\"fixStatus\\":\\"completed\\",\\"issueUrl\\":\\"$PR_URL\\"}"
\`\`\`

If \`gh\` is not available or PR creation fails, still push the branch and report completed without issueUrl:
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_CALLBACK_TOKEN" \\
  -H "X-Happy-Machine-Id: $HAPPY_SUPERVISOR_MACHINE_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"fixStatus":"completed"}'
\`\`\`

### On Failure:
\`\`\`
curl -s -X PATCH "${reportUrl}" \\
  -H "Authorization: Bearer $HAPPY_SUPERVISOR_CALLBACK_TOKEN" \\
  -H "X-Happy-Machine-Id: $HAPPY_SUPERVISOR_MACHINE_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"fixStatus":"failed"}'
\`\`\``;
}
