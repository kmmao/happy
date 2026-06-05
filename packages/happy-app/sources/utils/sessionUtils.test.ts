import { describe, it, expect, vi } from 'vitest';
import {
    applyRunningWorkflowStatus,
    formatApiRetryStatus,
    getLatestUserRequestPreview,
    getSessionProviderDisplayLabel,
    getSessionStatusState,
    getSessionSubtitle,
    formatPathRelativeToHome,
    isSessionRunning,
    shouldClearQueuedMessagesOnTransition,
    type SessionStatus,
} from './sessionUtils';
import { Session } from '@/sync/storageTypes';
import { Message } from '@/sync/typesMessage';

// Mock @/text to return deterministic translations for tests
vi.mock('@/text', () => ({
    t: (key: string, params?: Record<string, unknown>) => {
        const translations: Record<string, string | ((params?: Record<string, unknown>) => string)> = {
            'status.unknown': 'Unknown',
            'status.workflow': 'running workflow',
            'session.startedByDaemon': 'daemon',
            'session.startedByTerminal': 'Terminal',
            'agentInput.agent.codex': 'Codex',
            'agentInput.agent.claude': 'Claude',
            'agentInput.agent.gemini': 'Gemini',
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

function createUserTextMessage(overrides: Partial<Message> & { text: string }): Message {
    return {
        kind: 'user-text',
        id: 'msg-1',
        realId: null,
        localId: null,
        createdAt: Date.now(),
        ...overrides,
        text: overrides.text,
    } as Message;
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

        it('treats 529 overloaded as the same wait-and-retry state as 429', () => {
            // Claude Code 2.1.150 split overloaded (529) out of rate_limit (429);
            // both still mean "wait then retry" from the user's perspective.
            const statusText = formatApiRetryStatus({
                attempt: 2,
                maxRetries: 5,
                retryDelayMs: 8000,
                errorStatus: 529,
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

        it('prefers a TUI window title over the static path', () => {
            // terminal-signal event with kind=window-title sets this via
            // sessionTerminalTitles[id]; the subtitle should display it
            // instead of the project path so remote users see the same
            // context a native terminal would show.
            const session = createSession();
            expect(getSessionSubtitle(session, 'build · passing')).toBe(
                'build · passing',
            );
        });

        it('falls back to the path when the TUI title is empty/whitespace', () => {
            // Empty or whitespace-only window titles are an OSC "clear" — the
            // subtitle should not render a blank line.
            const session = createSession();
            expect(getSessionSubtitle(session, '')).toBe('~/projects/my-app');
            expect(getSessionSubtitle(session, '   ')).toBe(
                '~/projects/my-app',
            );
            expect(getSessionSubtitle(session, null)).toBe('~/projects/my-app');
        });

        it('keeps the worktree branch label even when a TUI title is present', () => {
            // Worktree sessions identify themselves by branch arrow — that
            // identifier is more useful than whatever the TUI is currently
            // displaying, so the branch view wins.
            const session = createSession({
                metadata: {
                    path: '/home/user/projects/my-app',
                    host: 'localhost',
                    homeDir: '/home/user',
                    worktree: {
                        isWorktree: true,
                        branchName: 'feat/x',
                        parentBranch: 'main',
                    },
                },
            } as Partial<Session>);
            expect(getSessionSubtitle(session, 'build done')).toBe(
                'feat/x → main',
            );
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

    describe('getSessionProviderDisplayLabel', () => {
        it('combines provider and normalized model label for session list display', () => {
            const session = createSession({
                metadata: {
                    path: '/home/user/projects/my-app',
                    host: 'localhost',
                    homeDir: '/home/user',
                    flavor: 'codex',
                    currentModelCode: 'gpt-5.4-20260101',
                },
            } as Partial<Session>);

            expect(getSessionProviderDisplayLabel(session)).toBe('Codex · GPT-5');
        });

        it('avoids repeating the model when it matches the provider label', () => {
            const session = createSession({
                metadata: {
                    path: '/home/user/projects/my-app',
                    host: 'localhost',
                    homeDir: '/home/user',
                    flavor: 'codex',
                    currentModelCode: 'codex-20260101',
                },
            } as Partial<Session>);

            expect(getSessionProviderDisplayLabel(session)).toBe('Codex');
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

    describe('isSessionRunning', () => {
        it('uses sdkSessionState as the authoritative running signal', () => {
            const session = createSession({
                thinking: true,
                sdkSessionState: 'requires_action',
            });

            expect(isSessionRunning(session)).toBe(false);
        });

        it('returns true when sdkSessionState is running even if legacy thinking is false', () => {
            const session = createSession({
                thinking: false,
                sdkSessionState: 'running',
            });

            expect(isSessionRunning(session)).toBe(true);
        });

        it('falls back to legacy thinking when sdkSessionState is unavailable', () => {
            const session = createSession({
                thinking: true,
                sdkSessionState: null,
            });

            expect(isSessionRunning(session)).toBe(true);
        });
    });

    describe('shouldClearQueuedMessagesOnTransition', () => {
        it('does not clear when running transitions to requires_action', () => {
            expect(shouldClearQueuedMessagesOnTransition({
                prevIsRunning: true,
                nextIsRunning: false,
                nextSdkSessionState: 'requires_action',
            })).toBe(false);
        });

        it('clears when running transitions to idle', () => {
            expect(shouldClearQueuedMessagesOnTransition({
                prevIsRunning: true,
                nextIsRunning: false,
                nextSdkSessionState: 'idle',
            })).toBe(true);
        });

        it('clears when running transitions to unknown legacy idle state', () => {
            expect(shouldClearQueuedMessagesOnTransition({
                prevIsRunning: true,
                nextIsRunning: false,
                nextSdkSessionState: null,
            })).toBe(true);
        });
    });

    describe('getLatestUserRequestPreview', () => {
        it('uses the newest user-text from storage order where messages are sorted descending by createdAt', () => {
            const preview = getLatestUserRequestPreview([
                createUserTextMessage({ id: 'msg-newest', createdAt: 3000, text: '最新请求' }),
                {
                    kind: 'agent-text',
                    id: 'agent-1',
                    localId: null,
                    createdAt: 2500,
                    text: '处理中',
                } as Message,
                createUserTextMessage({ id: 'msg-oldest', createdAt: 1000, text: '最早请求' }),
            ]);

            expect(preview).toEqual({
                text: '最新请求',
                isAutoOptionSend: false,
            });
        });

        it('marks preview as auto option send when newest user-text has auto source', () => {
            const preview = getLatestUserRequestPreview([
                createUserTextMessage({
                    id: 'msg-2',
                    createdAt: 2000,
                    text: '自动确认继续',
                    meta: {
                        source: 'auto-option-send',
                    },
                }),
                createUserTextMessage({ id: 'msg-1', createdAt: 1000, text: '手动请求' }),
            ]);

            expect(preview).toEqual({
                text: '自动确认继续',
                isAutoOptionSend: true,
            });
        });

        it('uses displayText while preserving auto option source detection', () => {
            const preview = getLatestUserRequestPreview([
                createUserTextMessage({
                    id: 'msg-2',
                    createdAt: 2000,
                    text: '真实长文本',
                    displayText: '展示文本',
                    meta: {
                        source: 'auto-option-send',
                    },
                }),
            ]);

            expect(preview).toEqual({
                text: '展示文本',
                isAutoOptionSend: true,
            });
        });

        it('skips empty user-text messages and falls back to the latest non-empty one', () => {
            const preview = getLatestUserRequestPreview([
                createUserTextMessage({ id: 'msg-2', createdAt: 2000, text: '   \n  ' }),
                createUserTextMessage({ id: 'msg-1', createdAt: 1000, text: '有效请求' }),
            ]);

            expect(preview).toEqual({
                text: '有效请求',
                isAutoOptionSend: false,
            });
        });

        it('returns null when there is no non-empty user-text message', () => {
            const preview = getLatestUserRequestPreview([
                {
                    kind: 'agent-text',
                    id: 'agent-1',
                    localId: null,
                    createdAt: 1000,
                    text: '处理中',
                } as Message,
                createUserTextMessage({ id: 'msg-1', createdAt: 500, text: '   ' }),
            ]);

            expect(preview).toBeNull();
        });

        it('provides preview data for active session cards to render directly', () => {
            const preview = getLatestUserRequestPreview([
                createUserTextMessage({
                    id: 'msg-2',
                    createdAt: 2000,
                    text: '自动处理 issue #123',
                    meta: {
                        source: 'auto-option-send',
                    },
                }),
            ]);

            expect(preview?.text).toBe('自动处理 issue #123');
            expect(preview?.isAutoOptionSend).toBe(true);
        });
    });

    describe('getSessionStatusState', () => {
        it('returns thinking for sdk running even when legacy thinking is false', () => {
            const session = createSession({
                thinking: false,
                sdkSessionState: 'running',
            });

            expect(getSessionStatusState(session)).toBe('thinking');
        });

        it('returns needs_attention for requires_action even when legacy thinking is true', () => {
            const session = createSession({
                thinking: true,
                sdkSessionState: 'requires_action',
            });

            expect(getSessionStatusState(session)).toBe('needs_attention');
        });

        it('keeps permission_required ahead of requires_action', () => {
            const session = createSession({
                sdkSessionState: 'requires_action',
                agentState: {
                    requests: {
                        request1: {
                            tool: 'Bash',
                            arguments: {},
                            createdAt: Date.now(),
                        },
                    },
                },
            } as Partial<Session>);

            expect(getSessionStatusState(session)).toBe('permission_required');
        });

        it('treats null requests as no pending permission requests', () => {
            const session = createSession({
                sdkSessionState: 'requires_action',
                agentState: {
                    requests: null,
                },
            } as Partial<Session>);

            expect(getSessionStatusState(session)).toBe('needs_attention');
        });
    });

    describe('applyRunningWorkflowStatus', () => {
        function baseStatus(state: SessionStatus['state']): SessionStatus {
            return {
                state,
                isConnected: true,
                statusText: 'base',
                shouldShowStatus: state !== 'waiting',
                statusColor: '#000',
                statusDotColor: '#000',
            };
        }

        it('overrides waiting (ready) with the workflow status', () => {
            const result = applyRunningWorkflowStatus(baseStatus('waiting'), true);
            expect(result.state).toBe('workflow');
            expect(result.statusText).toBe('running workflow');
            expect(result.shouldShowStatus).toBe(true);
            expect(result.isPulsing).toBe(true);
        });

        it('overrides thinking with the workflow status', () => {
            const result = applyRunningWorkflowStatus(baseStatus('thinking'), true);
            expect(result.state).toBe('workflow');
        });

        it('does not override when no workflow is running', () => {
            const status = baseStatus('waiting');
            expect(applyRunningWorkflowStatus(status, false)).toBe(status);
        });

        it('never overrides states that need user attention or a connection', () => {
            for (const state of ['permission_required', 'needs_attention', 'disconnected'] as const) {
                const status = baseStatus(state);
                expect(applyRunningWorkflowStatus(status, true)).toBe(status);
            }
        });
    });
});
