import { describe, it, expect } from 'vitest';
import { MetadataSchema } from './storageTypes';

describe('MetadataSchema', () => {
    const baseMetadata = {
        path: '/home/user/project',
        host: 'my-host',
    };

    describe('startedBy field', () => {
        it('accepts daemon as startedBy value', () => {
            const result = MetadataSchema.safeParse({
                ...baseMetadata,
                startedBy: 'daemon',
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.startedBy).toBe('daemon');
            }
        });

        it('accepts terminal as startedBy value', () => {
            const result = MetadataSchema.safeParse({
                ...baseMetadata,
                startedBy: 'terminal',
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.startedBy).toBe('terminal');
            }
        });

        it('accepts metadata without startedBy (optional)', () => {
            const result = MetadataSchema.safeParse(baseMetadata);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.startedBy).toBeUndefined();
            }
        });

        it('rejects invalid startedBy values', () => {
            const result = MetadataSchema.safeParse({
                ...baseMetadata,
                startedBy: 'unknown',
            });
            expect(result.success).toBe(false);
        });
    });

    it('accepts codex backend metadata', () => {
        const result = MetadataSchema.safeParse({
            ...baseMetadata,
            flavor: 'codex',
            codex: {
                requestedBackend: 'codex-mcp-legacy',
                resolvedBackend: 'codex-mcp-legacy',
                configMode: 'inherit',
            },
        });

        expect(result.success).toBe(true);
    });

    it('accepts codex surface metadata for prompts, skills, and agents', () => {
        const result = MetadataSchema.safeParse({
            ...baseMetadata,
            flavor: 'codex',
            slashCommands: ['ecc-plan'],
            codex: {
                prompts: [
                    {
                        name: 'ecc-plan',
                        path: '/Users/test/.codex/prompts/ecc-plan.md',
                        description: 'Run the ECC planning workflow.',
                    },
                ],
                skills: [
                    {
                        name: 'tdd-workflow',
                        description: 'Test-driven development workflow',
                        path: '/Users/test/.agents/skills/tdd-workflow/SKILL.md',
                        enabled: true,
                    },
                ],
                agents: [
                    {
                        name: 'reviewer',
                        path: '/Users/test/.codex/agents/reviewer.toml',
                    },
                ],
            },
        });

        expect(result.success).toBe(true);
    });
});
