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
        expect(prompt).toContain('Run existing tests');
    });

    it('should instruct to commit with finding title', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain(`fix: ${baseOptions.title}`);
    });

    it('should include JSON output format', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('"status"');
        expect(prompt).toContain('"filesChanged"');
        expect(prompt).toContain('"testsPassed"');
    });

    it('should forbid creating branches or PRs', () => {
        const prompt = buildFixPrompt(baseOptions);
        expect(prompt).toContain('Do NOT create new branches or PRs');
    });
});
