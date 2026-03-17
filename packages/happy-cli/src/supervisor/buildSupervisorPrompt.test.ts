import { describe, expect, it } from 'vitest';
import { buildSupervisorPrompt, type SupervisorPromptOptions } from './buildSupervisorPrompt';

const baseOptions: SupervisorPromptOptions = {
    projectId: 'proj-1',
    runId: 'run-1',
    repoPath: '/home/user/my-project',
    trigger: 'manual',
    serverUrl: 'https://happyserve.example.com',
};

describe('buildSupervisorPrompt', () => {
    it('should include context fields in prompt', () => {
        const prompt = buildSupervisorPrompt(baseOptions);
        expect(prompt).toContain('proj-1');
        expect(prompt).toContain('run-1');
        expect(prompt).toContain('/home/user/my-project');
        expect(prompt).toContain('manual');
    });

    it('should use default dimensions when none provided', () => {
        const prompt = buildSupervisorPrompt(baseOptions);
        expect(prompt).toContain('Security');
        expect(prompt).toContain('Dependencies');
        expect(prompt).toContain('Architecture Consistency');
        // Non-default dimensions should not appear
        expect(prompt).not.toContain('### 4.');
    });

    it('should use custom dimensions when provided', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            dimensions: ['security', 'performance'],
        });
        expect(prompt).toContain('Security');
        expect(prompt).toContain('Performance');
        // Other defaults should not be present
        expect(prompt).not.toContain('Dependencies');
    });

    it('should include auto mode section when mode is auto', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            mode: 'auto',
        });
        expect(prompt).toContain('Auto Mode Notice');
        expect(prompt).toContain('PR merge ALWAYS requires human approval');
    });

    it('should not include auto mode section for other modes', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            mode: 'suggest',
        });
        expect(prompt).not.toContain('Auto Mode Notice');
    });

    it('should include incremental scan section with changed files', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            changedFiles: ['src/index.ts', 'src/utils.ts'],
        });
        expect(prompt).toContain('Incremental Scan');
        expect(prompt).toContain('`src/index.ts`');
        expect(prompt).toContain('`src/utils.ts`');
    });

    it('should not include incremental section when changedFiles is empty', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            changedFiles: [],
        });
        expect(prompt).not.toContain('Incremental Scan');
    });

    it('should include custom rules when provided', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            customRules: 'Always check for console.log statements',
        });
        expect(prompt).toContain('Custom Analysis Rules');
        expect(prompt).toContain('Always check for console.log statements');
    });

    it('should not include custom rules section when empty', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            customRules: '   ',
        });
        expect(prompt).not.toContain('Custom Analysis Rules');
    });

    it('should include JSON output format with correct categories', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            dimensions: ['security', 'techDebt'],
        });
        expect(prompt).toContain('"security"');
        expect(prompt).toContain('"tech-debt"');
    });

    it('should include confidence score guidelines', () => {
        const prompt = buildSupervisorPrompt(baseOptions);
        expect(prompt).toContain('Confidence Score Guidelines');
        expect(prompt).toContain('80-100');
    });

    it('should include severity guidelines', () => {
        const prompt = buildSupervisorPrompt(baseOptions);
        expect(prompt).toContain('Severity Guidelines');
        expect(prompt).toContain('critical');
        expect(prompt).toContain('high');
        expect(prompt).toContain('medium');
        expect(prompt).toContain('low');
    });

    it('should enforce read-only rules', () => {
        const prompt = buildSupervisorPrompt(baseOptions);
        expect(prompt).toContain('DO NOT modify any files');
        expect(prompt).toContain('DO NOT create commits');
    });

    it('should limit findings to 10', () => {
        const prompt = buildSupervisorPrompt(baseOptions);
        expect(prompt).toContain('not report more than 10 findings');
    });

    // === Existing Actions Dedup ===

    it('should include existing actions table when provided', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            existingActions: [
                { category: 'security', title: 'Hardcoded API key', severity: 'critical', approval: 'pending', fixStatus: null },
                { category: 'dependencies', title: 'Outdated lodash', severity: 'high', approval: 'approved', fixStatus: 'running' },
            ],
        });
        expect(prompt).toContain('Known Existing Findings');
        expect(prompt).toContain('DO NOT report these again');
        expect(prompt).toContain('Hardcoded API key');
        expect(prompt).toContain('Outdated lodash');
        expect(prompt).toContain('pending');
        expect(prompt).toContain('approved (fix running)');
    });

    it('should not include existing actions section when empty', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            existingActions: [],
        });
        expect(prompt).not.toContain('Known Existing Findings');
    });

    it('should not include existing actions section when undefined', () => {
        const prompt = buildSupervisorPrompt(baseOptions);
        expect(prompt).not.toContain('Known Existing Findings');
    });

    it('should format fixStatus in existing actions status column', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            existingActions: [
                { category: 'security', title: 'Issue A', severity: 'high', approval: 'approved', fixStatus: 'completed' },
                { category: 'dependencies', title: 'Issue B', severity: 'medium', approval: 'pending', fixStatus: null },
            ],
        });
        expect(prompt).toContain('approved (fix completed)');
        expect(prompt).toContain('| pending |');
    });

    it('should include differentiated guidance for skipped and ignored actions', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            existingActions: [
                { category: 'security', title: 'Skipped issue', severity: 'high', approval: 'skipped', fixStatus: null },
                { category: 'dependencies', title: 'Ignored issue', severity: 'medium', approval: 'ignored', fixStatus: null },
            ],
        });
        expect(prompt).toContain('SHOULD re-report');
        expect(prompt).toContain('DO NOT report them again');
        expect(prompt).toContain('skipped');
        expect(prompt).toContain('ignored');
    });
});
