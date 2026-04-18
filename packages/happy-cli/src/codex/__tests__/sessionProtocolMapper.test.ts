import { describe, expect, it } from 'vitest';
import { createId, isCuid } from '@paralleldrive/cuid2';
import {
    mapCodexMcpMessageToSessionEnvelopes,
    mapCodexProcessorMessageToSessionEnvelopes,
} from '../utils/sessionProtocolMapper';

describe('mapCodexMcpMessageToSessionEnvelopes', () => {
    it('starts and ends turns for task lifecycle events', () => {
        const started = mapCodexMcpMessageToSessionEnvelopes({ type: 'task_started' }, { currentTurnId: null });

        expect(started.envelopes).toHaveLength(1);
        expect(started.envelopes[0].ev.t).toBe('turn-start');
        expect(started.envelopes[0].turn).toBe(started.currentTurnId);
        expect(started.envelopes[0].turn).not.toBe(started.envelopes[0].id);

        const ended = mapCodexMcpMessageToSessionEnvelopes({ type: 'task_complete' }, { currentTurnId: started.currentTurnId });
        expect(ended.envelopes).toHaveLength(1);
        expect(ended.envelopes[0].ev.t).toBe('turn-end');
        if (ended.envelopes[0].ev.t === 'turn-end') {
            expect(ended.envelopes[0].ev.status).toBe('completed');
        }
        expect(ended.envelopes[0].turn).toBe(started.currentTurnId);
        expect(ended.currentTurnId).toBeNull();
    });

    it('maps abort lifecycle with cancelled turn-end status', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'turn_aborted' },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].ev).toEqual({
            t: 'turn-end',
            status: 'cancelled',
        });
        expect(result.currentTurnId).toBeNull();
    });

    it('maps agent text messages with turn context', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'agent_message', message: 'hello' },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].turn).toBe('turn-1');
        expect(result.envelopes[0].ev).toEqual({ t: 'text', text: 'hello' });
    });

    it('maps service messages to service envelopes', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'service_message', text: 'Codex App Server unavailable, fell back to Legacy MCP' },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].turn).toBe('turn-1');
        expect(result.envelopes[0].ev).toEqual({
            t: 'service',
            text: 'Codex App Server unavailable, fell back to Legacy MCP',
        });
    });

    it('maps text deltas to text-delta envelopes', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'text_delta', stream: 'item-1', delta: '你', thinking: false },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].ev).toEqual({
            t: 'text-delta',
            stream: 'item-1',
            delta: '你',
        });
    });

    it('maps parent call linkage to subagent field', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'agent_message', message: 'subagent hello', parent_call_id: 'parent-call-1' },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(2);
        const subagent = result.envelopes[1].subagent;
        expect(typeof subagent).toBe('string');
        expect(isCuid(subagent!)).toBe(true);
        expect(result.envelopes[0]).toMatchObject({
            subagent,
            ev: { t: 'start' },
        });
        expect(subagent).not.toBe('parent-call-1');
    });

    it('emits stop for active subagents before turn-end', () => {
        const subagent = createId();
        const activeSubagents = new Set<string>([subagent]);
        const startedSubagents = new Set<string>([subagent]);
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'task_complete' },
            { currentTurnId: 'turn-1', activeSubagents, startedSubagents }
        );

        expect(result.envelopes).toHaveLength(2);
        expect(result.envelopes[0]).toMatchObject({
            subagent,
            ev: { t: 'stop' },
        });
        expect(result.envelopes[1].ev).toEqual({
            t: 'turn-end',
            status: 'completed',
        });
    });

    it('maps exec command begin to tool-call-start', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'exec_command_begin',
                call_id: 'call-1',
                command: 'ls -la',
                cwd: '/tmp',
            },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        const envelope = result.envelopes[0];
        expect(envelope.ev.t).toBe('tool-call-start');
        if (envelope.ev.t === 'tool-call-start') {
            expect(envelope.ev.call).toBe('call-1');
            expect(envelope.ev.name).toBe('CodexBash');
            expect(envelope.ev.title).toContain('Run `ls -la`');
            expect(envelope.ev.args).toEqual({ command: 'ls -la', cwd: '/tmp' });
        }
    });

    it('maps parsed read commands to Read tool semantics', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'exec_command_begin',
                call_id: 'call-read',
                command: ['/bin/zsh', '-lc', "sed -n '1,40p' src/foo.ts"],
                cwd: '/tmp',
                parsed_cmd: [
                    {
                        type: 'read',
                        cmd: "sed -n '1,40p' src/foo.ts",
                        name: 'foo.ts',
                        path: 'src/foo.ts',
                    },
                ],
            },
            { currentTurnId: 'turn-1' }
        );

        const envelope = result.envelopes[0];
        expect(envelope.ev.t).toBe('tool-call-start');
        if (envelope.ev.t === 'tool-call-start') {
            expect(envelope.ev.name).toBe('Read');
            expect(envelope.ev.title).toBe('src/foo.ts');
            expect(envelope.ev.description).toBe('Reading foo.ts');
            expect(envelope.ev.args).toMatchObject({
                file_path: 'src/foo.ts',
                cwd: '/tmp',
            });
        }
    });

    it('maps parsed search commands to Grep tool semantics', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'exec_command_begin',
                call_id: 'call-search',
                command: ['/bin/zsh', '-lc', 'rg -n "foo" src -S'],
                cwd: '/tmp',
                parsed_cmd: [
                    {
                        type: 'search',
                        cmd: 'rg -n "foo" src -S',
                        query: 'foo',
                        path: 'src',
                    },
                ],
            },
            { currentTurnId: 'turn-1' }
        );

        const envelope = result.envelopes[0];
        expect(envelope.ev.t).toBe('tool-call-start');
        if (envelope.ev.t === 'tool-call-start') {
            expect(envelope.ev.name).toBe('Grep');
            expect(envelope.ev.title).toBe('grep(pattern: foo)');
            expect(envelope.ev.description).toBe('Search(pattern: foo)');
            expect(envelope.ev.args).toMatchObject({
                pattern: 'foo',
                path: 'src',
                cwd: '/tmp',
            });
        }
    });

    it('preserves description overrides on generic tool-call messages', () => {
        const events = mapCodexProcessorMessageToSessionEnvelopes({
            type: 'tool-call',
            callId: 'call-1',
            name: 'mcp__happy__change_title',
            input: {
                title: 'mcp__happy__change_title',
                description: 'waiting for permission review',
            },
            id: 'legacy-id-progress',
        } as any, { currentTurnId: 'turn-1' });

        expect(events).toHaveLength(1);
        expect(events[0].ev.t).toBe('tool-call-start');
        if (events[0].ev.t === 'tool-call-start') {
            expect(events[0].ev.description).toBe('waiting for permission review');
        }
    });

    it('skips token_count messages', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            { type: 'token_count', total_tokens: 10 },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(0);
        expect(result.currentTurnId).toBe('turn-1');
    });

    it('preserves official Codex patch fileChange payloads on patch_apply_begin', () => {
        const result = mapCodexMcpMessageToSessionEnvelopes(
            {
                type: 'patch_apply_begin',
                call_id: 'patch-1',
                auto_approved: true,
                changes: {
                    '/repo/src/example.ts': {
                        path: '/repo/src/example.ts',
                        kind: { type: 'update' },
                        diff: '@@ -1 +1 @@\n-old\n+new',
                    },
                },
            },
            { currentTurnId: 'turn-1' }
        );

        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].ev.t).toBe('tool-call-start');
        if (result.envelopes[0].ev.t === 'tool-call-start') {
            expect(result.envelopes[0].ev.call).toBe('patch-1');
            expect(result.envelopes[0].ev.name).toBe('CodexPatch');
            expect(result.envelopes[0].ev.args).toEqual({
                auto_approved: true,
                changes: {
                    '/repo/src/example.ts': {
                        path: '/repo/src/example.ts',
                        kind: { type: 'update' },
                        diff: '@@ -1 +1 @@\n-old\n+new',
                    },
                },
            });
        }
    });
});

describe('mapCodexProcessorMessageToSessionEnvelopes', () => {
    it('maps reasoning tool lifecycle to start/text/end session events', () => {
        const startEvents = mapCodexProcessorMessageToSessionEnvelopes({
            type: 'tool-call',
            callId: 'reasoning-1',
            name: 'CodexReasoning',
            input: { title: 'Plan changes' },
            id: 'legacy-id-1',
        }, { currentTurnId: 'turn-1' });

        expect(startEvents).toHaveLength(1);
        expect(startEvents[0].ev.t).toBe('tool-call-start');

        const endEvents = mapCodexProcessorMessageToSessionEnvelopes({
            type: 'tool-call-result',
            callId: 'reasoning-1',
            output: { content: 'Step 1, Step 2', status: 'completed' },
            id: 'legacy-id-2',
        }, { currentTurnId: 'turn-1' });

        expect(endEvents).toHaveLength(2);
        expect(endEvents[0].ev.t).toBe('text');
        if (endEvents[0].ev.t === 'text') {
            expect(endEvents[0].ev.thinking).toBe(true);
        }
        expect(endEvents[1].ev).toEqual({ t: 'tool-call-end', call: 'reasoning-1' });
    });

    it('maps Codex app-server style tool-call fields without dropping tool identity', () => {
        const events = mapCodexProcessorMessageToSessionEnvelopes({
            type: 'tool-call',
            callId: 'codex-diff-1',
            toolName: 'CodexDiff',
            args: {
                unified_diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new',
            },
        } as any, { currentTurnId: 'turn-1' });

        expect(events).toHaveLength(1);
        expect(events[0].ev.t).toBe('tool-call-start');
        if (events[0].ev.t === 'tool-call-start') {
            expect(events[0].ev.call).toBe('codex-diff-1');
            expect(events[0].ev.name).toBe('CodexDiff');
            expect(events[0].ev.args).toEqual({
                unified_diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new',
            });
        }
    });

    it('maps generic tool-call payloads that use tool/arguments fields', () => {
        const events = mapCodexProcessorMessageToSessionEnvelopes({
            type: 'tool-call',
            callId: 'dynamic-1',
            tool: 'mcp__happy__change_title',
            arguments: {
                title: '新标题',
            },
        } as any, { currentTurnId: 'turn-1' });

        expect(events).toHaveLength(1);
        expect(events[0].ev.t).toBe('tool-call-start');
        if (events[0].ev.t === 'tool-call-start') {
            expect(events[0].ev.call).toBe('dynamic-1');
            expect(events[0].ev.name).toBe('mcp__happy__change_title');
            expect(events[0].ev.title).toBe('新标题');
            expect(events[0].ev.description).toBe('新标题');
            expect(events[0].ev.args).toEqual({
                title: '新标题',
            });
        }
    });

    it('maps reasoning text to thinking text event', () => {
        const events = mapCodexProcessorMessageToSessionEnvelopes({
            type: 'reasoning',
            message: 'Working through options',
            id: 'legacy-id-3',
        }, { currentTurnId: 'turn-1' });

        expect(events).toHaveLength(1);
        expect(events[0].ev).toEqual({
            t: 'text',
            text: 'Working through options',
            thinking: true,
        });
    });
});
