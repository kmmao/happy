import { describe, it, expect, vi } from 'vitest';
import { formatApiRetryStatus, getSessionSubtitle, formatPathRelativeToHome } from './sessionUtils';
import { Session } from '@/sync/storageTypes';

// Mock @/text to return deterministic translations for tests
vi.mock('@/text', () => ({
    t: (key: string, params?: Record<string, unknown>) => {
        const translations: Record<string, string | ((params?: Record<string, unknown>) => string)> = {
            'status.unknown': 'Unknown',
            'session.startedByDaemon': 'daemon',
            'session.startedByTerminal': 'Terminal',
            'status.apiRetry': (values) => values?.isRateLimit
                ? `Waiting for rate limit reset (${String(values?.retryDelaySeconds)}s)…`
                : `retrying API (${String(values?.attempt)}/${String(values?.maxRetries)})…`,
        };
        const translation = translations[key];
        if (typeof translation === 'function') {
            return translation(params);
        }
        return translation || key;
    }
}));

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'test-session-id',
        seq: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: true,
        activeAt: Date.now(),
        presence: 'online',
        thinking: false,
        thinkingAt: 0,
        metadata: {
            path: '/home/user/projects/my-app',
            host: 'localhost',
            homeDir: '/home/user',
        },
        agentState: null,
        messages: [],
        permissionMode: 'default',
        ...overrides,
    } as Session;
}

describe('sessionUtils', () => {
    describe('formatApiRetryStatus', () => {
        it('shows a friendly retry message with remaining seconds for rate limits', () => {
            const statusText = formatApiRetryStatus({
                attempt: 2,
                maxRetries: 5,
                retryDelayMs: 8000,
                errorStatus: 429,
            });

            expect(statusText).toBe('Waiting for rate limit reset (8s)…');
        });

        it('falls back to generic retry text for non-rate-limit retries', () => {
            const statusText = formatApiRetryStatus({
                attempt: 2,
                maxRetries: 5,
                retryDelayMs: 8000,
                errorStatus: 500,
            });

            expect(statusText).toBe('retrying API (2/5)…');
        });

        it('does not force a minimum one second delay', () => {
            const statusText = formatApiRetryStatus({
                attempt: 1,
                maxRetries: 5,
                retryDelayMs: 0,
                errorStatus: 429,
            });

            expect(statusText).toBe('Waiting for rate limit reset (0s)…');
        });
    });

    describe('getSessionSubtitle', () => {
        it('returns path relative to home for terminal sessions', () => {
            const session = createSession();
            expect(getSessionSubtitle(session)).toBe('~/projects/my-app');
        });

        it('appends daemon label when session was started by daemon', () => {
            const session = createSession({
                metadata: {
                    path: '/home/user/projects/my-app',
                    host: 'localhost',
                    homeDir: '/home/user',
                    startedBy: 'daemon',
                },
            } as Partial<Session>);
            expect(getSessionSubtitle(session)).toBe('~/projects/my-app · daemon');
        });

        it('does not append label for terminal sessions', () => {
            const session = createSession({
                metadata: {
                    path: '/home/user/projects/my-app',
                    host: 'localhost',
                    homeDir: '/home/user',
                    startedBy: 'terminal',
                },
            } as Partial<Session>);
            expect(getSessionSubtitle(session)).toBe('~/projects/my-app');
        });

        it('does not append label when startedBy is not set', () => {
            const session = createSession();
            expect(getSessionSubtitle(session)).not.toContain('·');
        });

        it('returns Unknown when metadata is missing', () => {
            const session = createSession({ metadata: null } as Partial<Session>);
            expect(getSessionSubtitle(session)).toBe('Unknown');
        });
    });

    describe('formatPathRelativeToHome', () => {
        it('replaces home dir with ~', () => {
            expect(formatPathRelativeToHome('/home/user/projects', '/home/user')).toBe('~/projects');
        });

        it('returns full path when no homeDir', () => {
            expect(formatPathRelativeToHome('/home/user/projects')).toBe('/home/user/projects');
        });

        it('returns ~ for exact home dir match', () => {
            expect(formatPathRelativeToHome('/home/user', '/home/user')).toBe('~');
        });
    });
});
