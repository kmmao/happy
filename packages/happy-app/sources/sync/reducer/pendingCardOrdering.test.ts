import { describe, it, expect } from 'vitest';
import { createReducer, reducer } from './reducer';
import { NormalizedMessage } from '../typesRaw';
import { AgentState } from '../storageTypes';

// In PTY/Yolo mode the mcp__happy__ask_user request carries its own createdAt
// (Date.now() at tool-call time), which can predate the surrounding agent
// prose. The chat list is inverted (higher index → higher on screen), so a
// picker with an earlier createdAt sorts to a higher index and jumps ABOVE the
// conclusion it belongs under. The reducer anchors the synthetic card's
// createdAt to the latest agent-text time so it always renders below the prose.
describe('pending permission/question card ordering', () => {
    function agentText(id: string, createdAt: number, text: string): NormalizedMessage {
        return {
            id,
            localId: null,
            createdAt,
            role: 'agent',
            isSidechain: false,
            content: [{ type: 'text', text, uuid: `${id}-c`, parentUUID: null }],
        };
    }

    it('anchors a same-batch picker below the agent prose that precedes it', () => {
        const state = createReducer();

        // Agent writes the conclusion (createdAt 5000), then asks via mcp picker.
        // The picker request carries an EARLIER createdAt (3000), as happens in
        // PTY mode where the request timestamp predates the recorded prose.
        const messages: NormalizedMessage[] = [agentText('text1', 5000, 'Here is my analysis. Pick one:')];
        const agentState: AgentState = {
            requests: {
                'ask1': {
                    tool: 'mcp__happy__ask_user',
                    arguments: { question: 'Pick one' },
                    createdAt: 3000,
                },
            },
        };

        const result = reducer(state, messages, agentState);

        const text = result.messages.find((m) => m.kind === 'agent-text');
        const picker = result.messages.find((m) => m.kind === 'tool-call');
        expect(text).toBeDefined();
        expect(picker).toBeDefined();

        // Card createdAt is bumped up to (at least) the prose time, never left earlier.
        expect(picker!.createdAt).toBeGreaterThanOrEqual(text!.createdAt);

        // result.messages is newest-first; the list is inverted, so the prose
        // must sit at a HIGHER index than the picker to render above it.
        const textIndex = result.messages.findIndex((m) => m.kind === 'agent-text');
        const pickerIndex = result.messages.findIndex((m) => m.kind === 'tool-call');
        expect(textIndex).toBeGreaterThan(pickerIndex);
    });

    it('anchors a later-batch picker using the remembered agent-text time', () => {
        const state = createReducer();

        // Prose arrives first and is remembered in state.latestAgentTextTime.
        reducer(state, [agentText('text1', 5000, 'Here is my analysis. Pick one:')], undefined);

        // Picker arrives in a later batch with an earlier request timestamp.
        const agentState: AgentState = {
            requests: {
                'ask1': {
                    tool: 'mcp__happy__ask_user',
                    arguments: { question: 'Pick one' },
                    createdAt: 3000,
                },
            },
        };
        reducer(state, [], agentState);

        const picker = Array.from(state.messages.values()).find(
            (m) => m.tool?.name === 'mcp__happy__ask_user',
        );
        expect(picker).toBeDefined();
        expect(picker!.createdAt).toBeGreaterThanOrEqual(5000);
    });

    it('leaves a picker that is already newer than the prose untouched', () => {
        const state = createReducer();

        const messages: NormalizedMessage[] = [agentText('text1', 1000, 'Earlier note')];
        const agentState: AgentState = {
            requests: {
                'ask1': {
                    tool: 'mcp__happy__ask_user',
                    arguments: { question: 'Pick one' },
                    createdAt: 4000,
                },
            },
        };

        const result = reducer(state, messages, agentState);
        const picker = result.messages.find((m) => m.kind === 'tool-call');
        expect(picker!.createdAt).toBe(4000);
    });
});
