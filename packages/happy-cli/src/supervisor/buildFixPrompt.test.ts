import { describe, expect, it } from 'vitest';
import { buildFixPrompt, type FixPromptOptions } from './buildFixPrompt';

const baseOptions: FixPromptOptions = {
    projectId: 'proj-1',
    actionId: 'action-1',
    repoPath: '/home/user/my-project',
    title: 'Outdated lodash dependency',
    description: 'lodash is 3 major versions behind',
    suggestedFix: 'Run yarn upgrade lodash',
    category: 'dependencies',
    severity: 'high',
    serverUrl: 'https://example.com',
    branchName: 'fix-clever-ocean-a3f1',
    parentBranch: 'main',
};

describe('buildFixPrompt', () => {
    it('should include all context fields', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('proj-1');
        expect(prompt).toContain('action-1');
        expect(prompt).toContain('/home/user/my-project');
        expect(prompt).toContain('dependencies');
        expect(prompt).toContain('high');
    });

    it('should include finding title and description', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('Outdated lodash dependency');
        expect(prompt).toContain('lodash is 3 major versions behind');
    });

    it('should include suggested fix when provided', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('Suggested Fix');
        expect(prompt).toContain('Run yarn upgrade lodash');
    });

    it('should omit suggested fix section when null', () => {
        const prompt = buildFixPrompt({
            ...baseOptions,
            suggestedFix: null,
        });
        expect(prompt).not.toContain('Suggested Fix');
    });

    it('should enforce minimal changes rule', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('Fix ONLY the specific issue');
        expect(prompt).toContain('minimal, targeted changes');
    });

    it('should instruct to run tests', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('Run tests');
    });

    it('should instruct to commit with finding title', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain(`fix: ${baseOptions.title}`);
    });

    it('should include curl reporting instructions', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('curl');
        expect(prompt).toContain('HAPPY_SUPERVISOR_AUTH_TOKEN');
        expect(prompt).toContain('"fixStatus":"completed"');
        expect(prompt).toContain('"fixStatus":"failed"');
    });

    it('should include worktree branch info', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('fix-clever-ocean-a3f1');
        expect(prompt).toContain('Parent branch: main');
    });

    // === Direct mode (default) ===

    it('should default to direct merge mode', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('Direct Merge Mode');
        expect(prompt).toContain(`git push origin ${baseOptions.branchName}:${baseOptions.parentBranch}`);
    });

    it('should include rebase instructions in direct mode', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('git fetch origin main');
        expect(prompt).toContain('git rebase origin/main');
    });

    it('should run tests again after rebase in direct mode', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('Run tests AGAIN after rebase');
    });

    it('should include fallback to PR instructions in direct mode', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('Fallback to PR Mode');
        expect(prompt).toContain('git rebase --abort');
        expect(prompt).toContain('gh pr create');
    });

    it('should not include gh pr create as a primary step in direct mode', () => {
        const prompt = buildFixPrompt(baseOptions);
        // In direct mode, PR creation is only in the fallback section
        const mainProcess = prompt.split('Fallback to PR Mode')[0];
        expect(mainProcess).not.toContain('gh pr create');
    });

    it('should include Closes #N in direct mode commit message when issueNumber provided', () => {
        const prompt = buildFixPrompt({
            ...baseOptions,
            issueNumber: 42,
        });
        expect(prompt).toContain('Closes #42');
    });

    it('should not include Closes reference when issueNumber is absent in direct mode', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).not.toContain('Closes #');
    });

    // === PR mode ===

    it('should use PR mode when fixStrategy is "pr"', () => {
        const prompt = buildFixPrompt({
            ...baseOptions,
            fixStrategy: 'pr',
        });
        expect(prompt).toContain('Pull Request Mode');
        expect(prompt).toContain(`git push -u origin ${baseOptions.branchName}`);
        expect(prompt).toContain('gh pr create --base "main"');
    });

    it('should not include direct push in PR mode', () => {
        const prompt = buildFixPrompt({
            ...baseOptions,
            fixStrategy: 'pr',
        });
        expect(prompt).not.toContain(`git push origin ${baseOptions.branchName}:${baseOptions.parentBranch}`);
    });

    it('should include PR URL in success report in PR mode', () => {
        const prompt = buildFixPrompt({
            ...baseOptions,
            fixStrategy: 'pr',
        });
        expect(prompt).toContain('issueUrl');
        expect(prompt).toContain('gh pr view --json url');
    });

    it('should include Closes #N in PR body when issueNumber is provided', () => {
        const prompt = buildFixPrompt({
            ...baseOptions,
            fixStrategy: 'pr',
            issueNumber: 42,
        });
        expect(prompt).toContain('Closes #42');
    });

    it('should not include Closes reference in PR mode when issueNumber is absent', () => {
        const prompt = buildFixPrompt({
            ...baseOptions,
            fixStrategy: 'pr',
        });
        expect(prompt).not.toContain('Closes #');
    });

    // === Explicit direct mode ===

    it('should use direct mode when fixStrategy is explicitly "direct"', () => {
        const prompt = buildFixPrompt({
            ...baseOptions,
            fixStrategy: 'direct',
        });
        expect(prompt).toContain('Direct Merge Mode');
    });
});
