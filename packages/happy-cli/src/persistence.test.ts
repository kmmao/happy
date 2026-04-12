import { describe, expect, it } from 'vitest';
import {
    AIBackendProfileSchema,
    SandboxConfigSchema,
    getProfileEnvironmentVariables,
} from './persistence';

describe('SandboxConfigSchema', () => {
    it('applies defaults when values are omitted', () => {
        const parsed = SandboxConfigSchema.parse({});

        expect(parsed).toEqual({
            enabled: false,
            sessionIsolation: 'workspace',
            customWritePaths: [],
            denyReadPaths: ['~/.ssh', '~/.aws', '~/.gnupg'],
            extraWritePaths: ['/tmp'],
            denyWritePaths: ['.env'],
            networkMode: 'allowed',
            allowedDomains: [],
            deniedDomains: [],
            allowLocalBinding: true,
        });
    });

    it('accepts a fully custom valid sandbox config', () => {
        const parsed = SandboxConfigSchema.parse({
            enabled: true,
            workspaceRoot: '~/projects',
            sessionIsolation: 'custom',
            customWritePaths: ['~/projects/foo', '/var/tmp'],
            denyReadPaths: ['~/.ssh'],
            extraWritePaths: ['/tmp', '/private/tmp'],
            denyWritePaths: ['.env', '.secrets'],
            networkMode: 'custom',
            allowedDomains: ['api.openai.com', '*.github.com'],
            deniedDomains: ['tracking.example.com'],
            allowLocalBinding: false,
        });

        expect(parsed.enabled).toBe(true);
        expect(parsed.workspaceRoot).toBe('~/projects');
        expect(parsed.sessionIsolation).toBe('custom');
        expect(parsed.networkMode).toBe('custom');
        expect(parsed.allowedDomains).toEqual(['api.openai.com', '*.github.com']);
        expect(parsed.allowLocalBinding).toBe(false);
    });

    it('rejects invalid enum values', () => {
        expect(() =>
            SandboxConfigSchema.parse({
                sessionIsolation: 'invalid',
            }),
        ).toThrow();

        expect(() =>
            SandboxConfigSchema.parse({
                networkMode: 'invalid',
            }),
        ).toThrow();
    });

    it('rejects invalid field types', () => {
        expect(() =>
            SandboxConfigSchema.parse({
                allowLocalBinding: 'yes',
            }),
        ).toThrow();

        expect(() =>
            SandboxConfigSchema.parse({
                denyReadPaths: [123],
            }),
        ).toThrow();
    });
});

describe('AIBackendProfileSchema codexConfig', () => {
    it('accepts codexConfig fields and maps them to internal env vars', () => {
        const profile = AIBackendProfileSchema.parse({
            id: crypto.randomUUID(),
            name: 'Codex Profile',
            codexConfig: {
                backendMode: 'codex-app-server',
                configMode: 'managed-profile',
                codexProfileName: 'happy_max',
            },
            environmentVariables: [],
            compatibility: { claude: true, codex: true, gemini: true },
        });

        expect(getProfileEnvironmentVariables(profile)).toMatchObject({
            HAPPY_CODEX_BACKEND: 'codex-app-server',
            HAPPY_CODEX_CONFIG_MODE: 'managed-profile',
            HAPPY_CODEX_PROFILE: 'happy_max',
        });
    });

    it('maps managed override codexConfig values to internal env vars', () => {
        const profile = AIBackendProfileSchema.parse({
            id: crypto.randomUUID(),
            name: 'Codex Override Profile',
            codexConfig: {
                backendMode: 'auto',
                configMode: 'managed-overrides',
                model: 'gpt-5.4',
                reasoningEffort: 'high',
                serviceTier: 'default',
                webSearchEnabled: true,
            },
            environmentVariables: [],
            compatibility: { claude: true, codex: true, gemini: true },
        });

        expect(getProfileEnvironmentVariables(profile)).toMatchObject({
            HAPPY_CODEX_BACKEND: 'auto',
            HAPPY_CODEX_CONFIG_MODE: 'managed-overrides',
            HAPPY_CODEX_MODEL: 'gpt-5.4',
            HAPPY_CODEX_REASONING_EFFORT: 'high',
            HAPPY_CODEX_SERVICE_TIER: 'default',
            HAPPY_CODEX_WEB_SEARCH: 'live',
        });
    });
});
