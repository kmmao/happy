import { describe, expect, it } from 'vitest';
import { resolveLiveEndpoint } from '@/sync/apiLive';
import { buildSessionConfig, REALTIME_TOOLS } from './sessionConfig';
import { contextItemEvent, parseServerEvent, userTextItemEvent } from './events';

describe('resolveLiveEndpoint', () => {
    it('appends /v1/live to a bare base URL', () => {
        expect(resolveLiveEndpoint('https://gateway.example.com')).toBe(
            'https://gateway.example.com/v1/live',
        );
    });

    it('does not duplicate a /v1 already present in the base URL', () => {
        expect(resolveLiveEndpoint('https://gateway.example.com/v1/')).toBe(
            'https://gateway.example.com/v1/live',
        );
    });

    it('rejects an empty base URL', () => {
        expect(() => resolveLiveEndpoint('   ')).toThrow();
    });
});

describe('buildSessionConfig', () => {
    it('declares the quicksilver session type the Codex upstream requires', () => {
        expect(buildSessionConfig({ sessionId: 'sess-1' }).type).toBe('quicksilver');
    });

    it('never sends a model — the Codex upstream rejects the field outright', () => {
        const session = buildSessionConfig({ sessionId: 'sess-1', voice: 'marin' });
        expect(session).not.toHaveProperty('model');
        expect(JSON.stringify(session)).not.toContain('"model"');
    });

    it('omits voice when it is not configured', () => {
        const session = buildSessionConfig({ sessionId: 'sess-1' });
        expect(session.audio).toEqual({
            input: { turn_detection: { type: 'semantic_vad' } },
            output: {},
        });
    });

    it('passes through the configured voice', () => {
        const session = buildSessionConfig({ sessionId: 'sess-1', voice: 'marin' });
        expect(session.audio).toMatchObject({ output: { voice: 'marin' } });
    });

    it('pins the spoken language when the user picked one', () => {
        const session = buildSessionConfig({ sessionId: 'sess-1', language: 'zh-CN' });
        expect(session.instructions).toContain('Chinese');
    });

    it('embeds the session id and initial context in the instructions', () => {
        const session = buildSessionConfig({
            sessionId: 'sess-42',
            initialContext: 'user asked to rename a file',
        });
        expect(session.instructions).toContain('sess-42');
        expect(session.instructions).toContain('user asked to rename a file');
    });

    it('advertises exactly the tools the client implements', () => {
        expect(REALTIME_TOOLS.map((tool) => tool.name)).toEqual([
            'messageClaudeCode',
            'processPermissionRequest',
        ]);
    });
});

describe('parseServerEvent', () => {
    it('parses a function call event', () => {
        const event = parseServerEvent(
            JSON.stringify({
                type: 'response.function_call_arguments.done',
                call_id: 'call_1',
                name: 'messageClaudeCode',
                arguments: '{"message":"hi"}',
            }),
        );
        expect(event).toEqual({
            type: 'response.function_call_arguments.done',
            call_id: 'call_1',
            name: 'messageClaudeCode',
            arguments: '{"message":"hi"}',
        });
    });

    it('ignores malformed frames and unhandled event types', () => {
        expect(parseServerEvent('not json')).toBeNull();
        expect(parseServerEvent(JSON.stringify({ type: 'response.audio.delta' }))).toBeNull();
    });
});

describe('conversation items', () => {
    it('queues user text as a user turn', () => {
        expect(userTextItemEvent('run the tests')).toMatchObject({
            item: { role: 'user', content: [{ type: 'input_text', text: 'run the tests' }] },
        });
    });

    it('queues contextual updates as system background knowledge', () => {
        expect(contextItemEvent('session went offline')).toMatchObject({
            item: { role: 'system' },
        });
    });
});
