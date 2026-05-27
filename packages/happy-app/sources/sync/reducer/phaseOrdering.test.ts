import { describe, it, expect } from 'vitest';
import { NormalizedMessage } from '../typesRaw';
import { createReducer, reducer } from './reducer';

/**
 * Cross-phase ordering invariants.
 *
 * `reducer()` runs a fixed sequence of phases (0 → 0.5 → 1 → 2 → 3 → 3.5 →
 * 3.7 → 4 → 5 → 6 → 6.5) over a single mutable state. The *order* of those
 * phases is the load-bearing contract: each phase relies on state another
 * phase populated earlier, and several behaviours are only correct because a
 * later phase observes what an earlier one left behind. That contract lives in
 * prose comments inside reducer.ts; the tests below pin it to observable output
 * so a phase reordering can't silently regress it.
 *
 * These intentionally exercise the public reducer interface only — no internal
 * phase functions are imported. The interface is the test surface.
 */
describe('reducer cross-phase ordering', () => {
    //
    // Phase 6 (force-complete stale running tools) must run AFTER Phase 3
    // (tool-call ingestion) and after latestAgentTextTime is advanced by agent
    // text. A running tool whose createdAt precedes a later agent-text in the
    // same batch is force-completed: the API requires tool_result before the
    // assistant can produce text, so a still-"running" tool at that point is
    // stale.
    //
    describe('Phase 6: stale running tool force-completion', () => {
        it('force-completes a running tool that precedes later agent text', () => {
            const state = createReducer();
            const messages: NormalizedMessage[] = [
                {
                    id: 'tool-msg',
                    localId: null,
                    createdAt: 1000,
                    role: 'agent',
                    isSidechain: false,
                    content: [{
                        type: 'tool-call',
                        id: 'tool-1',
                        name: 'Bash',
                        input: { command: 'ls -la' },
                        description: null,
                        uuid: 'tool-msg-uuid',
                        parentUUID: null,
                    }],
                },
                {
                    id: 'text-msg',
                    localId: null,
                    createdAt: 2000,
                    role: 'agent',
                    isSidechain: false,
                    content: [{
                        type: 'text',
                        text: 'All done.',
                        uuid: 'text-msg-uuid',
                        parentUUID: null,
                    }],
                },
            ];

            const result = reducer(state, messages);

            const toolMessage = result.messages.find((m) => m.kind === 'tool-call');
            expect(toolMessage).toBeDefined();
            if (toolMessage?.kind === 'tool-call') {
                // Force-completed by Phase 6 using latestAgentTextTime as the
                // completion timestamp.
                expect(toolMessage.tool.state).toBe('completed');
                expect(toolMessage.tool.completedAt).toBe(2000);
            }
        });

        it('does NOT force-complete a running Task tool (sidechain may still run)', () => {
            const state = createReducer();
            const messages: NormalizedMessage[] = [
                {
                    id: 'task-msg',
                    localId: null,
                    createdAt: 1000,
                    role: 'agent',
                    isSidechain: false,
                    content: [{
                        type: 'tool-call',
                        id: 'task-1',
                        name: 'Task',
                        input: { prompt: 'do a thing' },
                        description: null,
                        uuid: 'task-msg-uuid',
                        parentUUID: null,
                    }],
                },
                {
                    id: 'text-msg',
                    localId: null,
                    createdAt: 2000,
                    role: 'agent',
                    isSidechain: false,
                    content: [{
                        type: 'text',
                        text: 'Continuing.',
                        uuid: 'text-msg-uuid',
                        parentUUID: null,
                    }],
                },
            ];

            const result = reducer(state, messages);

            const toolMessage = result.messages.find((m) => m.kind === 'tool-call');
            expect(toolMessage).toBeDefined();
            if (toolMessage?.kind === 'tool-call') {
                // Task/Agent tools are excluded from stale-completion — a nested
                // conversation can keep running after the parent emits text.
                expect(toolMessage.tool.state).toBe('running');
            }
        });
    });

    //
    // Phase 0.5 (message-to-event conversion) decides whether a "ready" event is
    // rendered. A session-protocol turn-end ready carries the visible turn
    // summary and renders an agent-event message. A legacy lifecycle-only ready
    // (no source/model/usage/cost/turns) is suppressed to avoid duplicate token
    // badges — but it still flips hasReadyEvent so downstream "is the turn done"
    // logic stays correct.
    //
    describe('Phase 0.5: ready event rendering', () => {
        it('renders a turn-end ready as an agent-event and flags hasReadyEvent', () => {
            const state = createReducer();
            const messages: NormalizedMessage[] = [
                {
                    id: 'ready-turn-end',
                    localId: null,
                    createdAt: 1000,
                    role: 'event',
                    isSidechain: false,
                    content: {
                        type: 'ready',
                        source: 'turn-end',
                        model: 'claude-opus-4-6',
                        usage: { input_tokens: 10, output_tokens: 20 },
                        durationMs: 1234,
                    },
                },
            ];

            const result = reducer(state, messages);

            expect(result.hasReadyEvent).toBe(true);
            const eventMessage = result.messages.find((m) => m.kind === 'agent-event');
            expect(eventMessage).toBeDefined();
            if (eventMessage?.kind === 'agent-event') {
                expect(eventMessage.event.type).toBe('ready');
            }
        });

        it('suppresses a legacy lifecycle-only ready but still flags hasReadyEvent', () => {
            const state = createReducer();
            const messages: NormalizedMessage[] = [
                {
                    id: 'ready-legacy',
                    localId: null,
                    createdAt: 1000,
                    role: 'event',
                    isSidechain: false,
                    content: {
                        type: 'ready',
                        // No source / model / usage / cost / turns — lifecycle-only.
                    },
                },
            ];

            const result = reducer(state, messages);

            // Flag flips, but nothing is rendered.
            expect(result.hasReadyEvent).toBe(true);
            const eventMessage = result.messages.find((m) => m.kind === 'agent-event');
            expect(eventMessage).toBeUndefined();
        });
    });

    //
    // Phase 5 (event messages) applies a content-based dedup window for lifecycle
    // messages: identical content within 5s of the last RENDERED occurrence is
    // suppressed. The window is anchored to the rendered occurrence and does NOT
    // slide forward as duplicates arrive — a duplicate never updates the stored
    // timestamp.
    //
    describe('Phase 5: lifecycle message dedup window', () => {
        it('suppresses duplicates inside the 5s window and renders once it elapses (anchored, not sliding)', () => {
            const state = createReducer();
            const messages: NormalizedMessage[] = [
                {
                    id: 'evt-1',
                    localId: null,
                    createdAt: 1000,
                    role: 'event',
                    isSidechain: false,
                    content: { type: 'message', message: 'Context was reset' },
                },
                {
                    // 3000ms after the first → inside the 5s window → suppressed.
                    id: 'evt-2',
                    localId: null,
                    createdAt: 4000,
                    role: 'event',
                    isSidechain: false,
                    content: { type: 'message', message: 'Context was reset' },
                },
                {
                    // 7000ms after the first. If the window slid to evt-2 (4000)
                    // this would be suppressed (8000-4000 < 5000); because it is
                    // anchored to the first RENDERED event (1000), 8000-1000 ≥ 5000
                    // → it renders.
                    id: 'evt-3',
                    localId: null,
                    createdAt: 8000,
                    role: 'event',
                    isSidechain: false,
                    content: { type: 'message', message: 'Context was reset' },
                },
            ];

            const result = reducer(state, messages);

            const rendered = result.messages.filter(
                (m) => m.kind === 'agent-event' && m.event.type === 'message',
            );
            expect(rendered).toHaveLength(2);
        });

        it('does not dedup distinct lifecycle contents against each other', () => {
            const state = createReducer();
            const messages: NormalizedMessage[] = [
                {
                    id: 'evt-1',
                    localId: null,
                    createdAt: 1000,
                    role: 'event',
                    isSidechain: false,
                    content: { type: 'message', message: 'Context was reset' },
                },
                {
                    id: 'evt-2',
                    localId: null,
                    createdAt: 1500,
                    role: 'event',
                    isSidechain: false,
                    content: { type: 'message', message: 'Compaction started' },
                },
            ];

            const result = reducer(state, messages);

            const rendered = result.messages.filter(
                (m) => m.kind === 'agent-event' && m.event.type === 'message',
            );
            expect(rendered).toHaveLength(2);
        });
    });
});
