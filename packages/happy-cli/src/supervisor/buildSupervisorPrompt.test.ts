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

    it('should not limit findings by default', () => {
        const prompt = buildSupervisorPrompt(baseOptions);
        expect(prompt).toContain('Report all findings you discover');
        expect(prompt).not.toContain('not report more than');
    });

    it('should limit findings when maxFindings is set', () => {
        const prompt = buildSupervisorPrompt({ ...baseOptions, maxFindings: 20 });
        expect(prompt).toContain('not report more than 20 findings');
    });

    it('should not limit findings when maxFindings is 0', () => {
        const prompt = buildSupervisorPrompt({ ...baseOptions, maxFindings: 0 });
        expect(prompt).toContain('Report all findings you discover');
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
        expect(prompt).toContain('DO NOT report any issue that is semantically similar');
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

    // === World Model (narrative + laws) ===

    it('should include narrative section when provided', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            narrative: 'This is a high-performance API gateway focused on security',
        });
        expect(prompt).toContain('Project Narrative');
        expect(prompt).toContain('high-performance API gateway focused on security');
    });

    it('should not include narrative section when empty', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            narrative: '   ',
        });
        expect(prompt).not.toContain('Project Narrative');
    });

    it('should include laws section with enabled laws sorted by severity', () => {
        const laws = JSON.stringify([
            { id: '1', category: 'quality', description: 'Test coverage >= 80%', enabled: true, severity: 'high' },
            { id: '2', category: 'security', description: 'No hardcoded API keys', enabled: true, severity: 'critical' },
            { id: '3', category: 'convention', description: 'Use ESLint', enabled: false, severity: 'low' },
        ]);
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            laws,
        });
        expect(prompt).toContain('Project Laws (MANDATORY');
        expect(prompt).toContain('No hardcoded API keys');
        expect(prompt).toContain('Test coverage >= 80%');
        // Disabled law should be filtered out
        expect(prompt).not.toContain('Use ESLint');
        // Critical should appear before high (sorted by severity)
        const criticalIdx = prompt.indexOf('No hardcoded API keys');
        const highIdx = prompt.indexOf('Test coverage >= 80%');
        expect(criticalIdx).toBeLessThan(highIdx);
    });

    it('should not include laws section when all laws are disabled', () => {
        const laws = JSON.stringify([
            { id: '1', category: 'quality', description: 'Disabled law', enabled: false, severity: 'high' },
        ]);
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            laws,
        });
        expect(prompt).not.toContain('Project Laws');
    });

    it('should not include laws section when laws is empty array', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            laws: '[]',
        });
        expect(prompt).not.toContain('Project Laws');
    });

    it('should gracefully handle invalid laws JSON', () => {
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            laws: 'not valid json{{{',
        });
        expect(prompt).not.toContain('Project Laws');
        // Should not throw
    });

    it('should include both narrative and laws when both provided', () => {
        const laws = JSON.stringify([
            { id: '1', category: 'security', description: 'No secrets in code', enabled: true, severity: 'critical' },
        ]);
        const prompt = buildSupervisorPrompt({
            ...baseOptions,
            narrative: 'A secure microservice',
            laws,
        });
        expect(prompt).toContain('Project Narrative');
        expect(prompt).toContain('A secure microservice');
        expect(prompt).toContain('Project Laws');
        expect(prompt).toContain('No secrets in code');
    });
});
