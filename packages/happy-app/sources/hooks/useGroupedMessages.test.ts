import { describe, expect, it, vi } from 'vitest';

// @/text drags in expo-localization / persistence / log (RN-only). groupMessages
// never calls t() — only generateGroupSummary does — so an identity stub is safe.
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { groupMessages } from './useGroupedMessages';
import type { Message, ToolCall } from '@/sync/typesMessage';

function tool(overrides: Partial<ToolCall> = {}): ToolCall {
    return {
        name: 'Bash',
        state: 'completed',
        input: {},
        createdAt: 0,
        startedAt: 0,
        completedAt: 0,
        description: null,
        ...overrides,
    };
}

function toolMessage(id: string, overrides: Partial<ToolCall> = {}): Message {
    return {
        kind: 'tool-call',
        id,
        realID: null,
        localId: null,
        createdAt: 0,
        tool: tool(overrides),
        children: [],
    };
}

function userText(id: string, text = 'hi'): Message {
    return {
        kind: 'user-text',
        id,
        realId: null,
        localId: null,
        createdAt: 0,
        text,
    };
}

function agentText(id: string, text = 'response'): Message {
    return {
        kind: 'agent-text',
        id,
        realID: null,
        localId: null,
        createdAt: 0,
        text,
    };
}

describe('groupMessages — hidden tools never pad an empty group', () => {
    it('does not produce an empty group for a lone successful change_title', () => {
        // Regression: a successful happy MCP tool is hidden by ToolView (renders
        // null), but used to still be counted into a tool-group, surfacing an
        // empty "Used 1 tool" header that expands to nothing.
        const result = groupMessages([
            toolMessage('t1', { name: 'mcp__happy__change_title', state: 'completed' }),
        ]);
        expect(result).toEqual([]);
    });

    it('drops a hidden change_title sandwiched between standalone messages', () => {
        const result = groupMessages([
            userText('u1'),
            toolMessage('t1', { name: 'mcp__happy__change_title', state: 'completed' }),
            agentText('a1'),
        ]);
        // Only the two standalone messages remain — no phantom tool-group.
        expect(result.map((i) => i.type)).toEqual(['message', 'message']);
    });

    it('also excludes statically-hidden tools (toolVisibility.isHiddenTool)', () => {
        const result = groupMessages([toolMessage('t1', { name: 'ToolSearch' })]);
        expect(result).toEqual([]);
    });

    it('still groups a normal completed tool', () => {
        const result = groupMessages([toolMessage('t1', { name: 'Bash' })]);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('tool-group');
        if (result[0].type === 'tool-group') {
            expect(result[0].messages).toHaveLength(1);
        }
    });

    it('keeps a change_title that is still awaiting permission (visible)', () => {
        const result = groupMessages([
            toolMessage('t1', {
                name: 'mcp__happy__change_title',
                state: 'running',
                permission: { id: 'p1', status: 'pending' },
            }),
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('tool-group');
    });

    it('keeps a failed change_title (error is visible)', () => {
        const result = groupMessages([
            toolMessage('t1', { name: 'mcp__happy__change_title', state: 'error' }),
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('tool-group');
    });

    it('does not collapse the group when a hidden tool sits next to a visible one', () => {
        const result = groupMessages([
            toolMessage('t1', { name: 'mcp__happy__change_title', state: 'completed' }),
            toolMessage('t2', { name: 'Bash', state: 'completed' }),
        ]);
        // Hidden tool excluded; the visible Bash still forms a group of one.
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('tool-group');
        if (result[0].type === 'tool-group') {
            expect(result[0].messages).toHaveLength(1);
            expect(result[0].messages[0].id).toBe('t2');
        }
    });

    it('merges visible tools around a hidden one (typical old session)', () => {
        // Old sessions persisted change_title inline between real tool calls.
        // Re-grouping on load must keep the visible tools in one group and only
        // drop the hidden one — nothing previously visible disappears.
        const result = groupMessages([
            toolMessage('t1', { name: 'Read' }),
            toolMessage('t2', { name: 'mcp__happy__change_title', state: 'completed' }),
            toolMessage('t3', { name: 'Read' }),
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('tool-group');
        if (result[0].type === 'tool-group') {
            expect(result[0].messages.map((m) => m.id)).toEqual(['t1', 't3']);
        }
    });
});
