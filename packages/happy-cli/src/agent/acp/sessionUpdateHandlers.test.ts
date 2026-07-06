/**
 * Characterization tests for sessionUpdateHandlers.
 *
 * These lock the observable behavior of the ACP tool-call lifecycle spine:
 * the active-call Set and the consolidated `toolCalls` tracker (name /
 * startTime / timeout per id) always move together — added in startToolCall,
 * deleted in complete/fail — and drive the emitted
 * status/tool-call/tool-result/idle messages. Keeping that invariant under
 * test guards the tracker against silently desyncing from the active Set.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentMessage } from '../core';
import type { TransportHandler } from '../transport';
import {
  type HandlerContext,
  parseArgsFromContent,
  extractErrorDetail,
  startToolCall,
  completeToolCall,
  failToolCall,
  handleToolCallUpdate,
  handleToolCall,
  handleAgentMessageChunk,
  handleAgentThoughtChunk,
  handleLegacyMessageChunk,
  handlePlanUpdate,
  handleThinkingUpdate,
} from './sessionUpdateHandlers';

function makeContext(overrides: Partial<HandlerContext> = {}) {
  const emitted: AgentMessage[] = [];
  let idleTimeout: NodeJS.Timeout | null = null;

  const transport = {
    agentName: 'test',
    getInitTimeout: () => 1000,
    getToolPatterns: () => [],
    mapToolName: (name: string) => name,
  } as unknown as TransportHandler;

  const ctx: HandlerContext = {
    transport,
    activeToolCalls: new Set<string>(),
    toolCalls: new Map(),
    idleTimeout: null,
    toolCallCountSincePrompt: 0,
    emit: (msg) => emitted.push(msg),
    emitIdleStatus: () => emitted.push({ type: 'status', status: 'idle' }),
    clearIdleTimeout: () => {
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = null;
      }
    },
    setIdleTimeout: (callback, ms) => {
      idleTimeout = setTimeout(callback, ms);
    },
    ...overrides,
  };

  return { ctx, emitted, getIdleTimeout: () => idleTimeout };
}

describe('parseArgsFromContent', () => {
  it('wraps an array under items', () => {
    expect(parseArgsFromContent([1, 2])).toEqual({ items: [1, 2] });
  });
  it('passes objects through', () => {
    expect(parseArgsFromContent({ a: 1 })).toEqual({ a: 1 });
  });
  it('returns {} for primitives and null', () => {
    expect(parseArgsFromContent('x')).toEqual({});
    expect(parseArgsFromContent(null)).toEqual({});
    expect(parseArgsFromContent(undefined)).toEqual({});
  });
});

describe('extractErrorDetail', () => {
  it('returns a plain string as-is', () => {
    expect(extractErrorDetail('boom')).toBe('boom');
  });
  it('reads error string field', () => {
    expect(extractErrorDetail({ error: 'nope' })).toBe('nope');
  });
  it('reads nested error.message', () => {
    expect(extractErrorDetail({ error: { message: 'deep' } })).toBe('deep');
  });
  it('falls back to message field', () => {
    expect(extractErrorDetail({ message: 'msg' })).toBe('msg');
  });
  it('falls back to status then reason', () => {
    expect(extractErrorDetail({ status: 'failed' })).toBe('failed');
    expect(extractErrorDetail({ reason: 'why' })).toBe('why');
  });
  it('returns undefined for empty content', () => {
    expect(extractErrorDetail(undefined)).toBeUndefined();
    expect(extractErrorDetail(null)).toBeUndefined();
  });
});

describe('tool-call lifecycle spine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('startToolCall populates the active Set and tool-call state together and emits running + tool-call', () => {
    const { ctx, emitted } = makeContext();

    startToolCall('t1', 'read', { content: { path: '/a' } }, ctx, 'tool_call');

    // The active Set and the consolidated state entry move together for the same id.
    expect(ctx.activeToolCalls.has('t1')).toBe(true);
    const state = ctx.toolCalls.get('t1');
    expect(state).toBeDefined();
    expect(state?.startTime).toBeTypeOf('number');
    expect(state?.timeout).toBeDefined();
    expect(state?.name).toBe('read');

    expect(emitted).toContainEqual({ type: 'status', status: 'running' });
    const toolCall = emitted.find((m) => m.type === 'tool-call');
    expect(toolCall).toMatchObject({ type: 'tool-call', toolName: 'read', callId: 't1' });
  });

  it('completeToolCall clears the active Set and tool-call state and emits result then idle', () => {
    const { ctx, emitted } = makeContext();
    startToolCall('t1', 'read', {}, ctx, 'tool_call');

    completeToolCall('t1', 'read', { ok: true }, ctx);

    expect(ctx.activeToolCalls.has('t1')).toBe(false);
    expect(ctx.toolCalls.has('t1')).toBe(false);

    expect(emitted).toContainEqual({
      type: 'tool-result',
      toolName: 'read',
      result: { ok: true },
      callId: 't1',
    });
    // Last message is idle since no tool calls remain.
    expect(emitted.at(-1)).toEqual({ type: 'status', status: 'idle' });
  });

  it('failToolCall emits an error result carrying status and cleans maps', () => {
    const { ctx, emitted } = makeContext();
    startToolCall('t1', 'bash', {}, ctx, 'tool_call');

    failToolCall('t1', 'failed', 'bash', { error: 'exploded' }, ctx);

    expect(ctx.activeToolCalls.has('t1')).toBe(false);
    expect(ctx.toolCalls.has('t1')).toBe(false);
    const result = emitted.find((m) => m.type === 'tool-result');
    expect(result).toEqual({
      type: 'tool-result',
      toolName: 'bash',
      result: { error: 'exploded', status: 'failed' },
      callId: 't1',
    });
    expect(emitted.at(-1)).toEqual({ type: 'status', status: 'idle' });
  });

  it('does not go idle while another tool call is still active', () => {
    const { ctx, emitted } = makeContext();
    startToolCall('t1', 'read', {}, ctx, 'tool_call');
    startToolCall('t2', 'read', {}, ctx, 'tool_call');

    completeToolCall('t1', 'read', {}, ctx);

    expect(ctx.activeToolCalls.has('t2')).toBe(true);
    expect(emitted.some((m) => m.type === 'status' && m.status === 'idle')).toBe(false);
  });
});

describe('handleToolCallUpdate routing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('starts a tool call and increments the per-prompt counter on in_progress', () => {
    const { ctx } = makeContext();
    const res = handleToolCallUpdate({ toolCallId: 't1', status: 'in_progress', kind: 'read' }, ctx);
    expect(res).toEqual({ handled: true, toolCallCountSincePrompt: 1 });
    expect(ctx.activeToolCalls.has('t1')).toBe(true);
  });

  it('routes completed and failed statuses to their handlers', () => {
    const { ctx, emitted } = makeContext();
    handleToolCallUpdate({ toolCallId: 't1', status: 'in_progress', kind: 'read' }, ctx);
    handleToolCallUpdate({ toolCallId: 't1', status: 'completed', kind: 'read', content: { ok: 1 } }, ctx);
    expect(ctx.activeToolCalls.has('t1')).toBe(false);
    expect(emitted.some((m) => m.type === 'tool-result')).toBe(true);
  });

  it('returns handled:false when toolCallId is missing', () => {
    const { ctx } = makeContext();
    expect(handleToolCallUpdate({ status: 'in_progress' }, ctx)).toEqual({ handled: false });
  });
});

describe('handleToolCall', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('starts an in-progress tool call', () => {
    const { ctx } = makeContext();
    expect(handleToolCall({ toolCallId: 't1', kind: 'read' }, ctx).handled).toBe(true);
    expect(ctx.activeToolCalls.has('t1')).toBe(true);
  });

  it('skips a non-in-progress status', () => {
    const { ctx } = makeContext();
    expect(handleToolCall({ toolCallId: 't1', status: 'completed' }, ctx)).toEqual({ handled: false });
  });

  it('ignores a duplicate active tool call without re-emitting', () => {
    const { ctx, emitted } = makeContext();
    handleToolCall({ toolCallId: 't1', kind: 'read' }, ctx);
    const before = emitted.length;
    const res = handleToolCall({ toolCallId: 't1', kind: 'read' }, ctx);
    expect(res).toEqual({ handled: true });
    expect(emitted.length).toBe(before);
  });
});

describe('chunk / plan / thinking handlers', () => {
  it('routes a bold-prefixed chunk to a thinking event', () => {
    const { ctx, emitted } = makeContext();
    const res = handleAgentMessageChunk({ content: { text: '**Reasoning**\nhello' } }, ctx);
    expect(res.handled).toBe(true);
    expect(emitted[0]).toMatchObject({ type: 'event', name: 'thinking' });
  });

  it('routes a normal chunk to model-output and arms the idle timeout', () => {
    const { ctx, emitted, getIdleTimeout } = makeContext();
    handleAgentMessageChunk({ content: { text: 'plain output' } }, ctx);
    expect(emitted[0]).toEqual({ type: 'model-output', textDelta: 'plain output' });
    expect(getIdleTimeout()).not.toBeNull();
  });

  it('returns handled:false for a chunk without text', () => {
    const { ctx } = makeContext();
    expect(handleAgentMessageChunk({ content: {} }, ctx).handled).toBe(false);
  });

  it('emits a thinking event for a thought chunk', () => {
    const { ctx, emitted } = makeContext();
    expect(handleAgentThoughtChunk({ content: { text: 'idea' } }, ctx).handled).toBe(true);
    expect(emitted[0]).toMatchObject({ type: 'event', name: 'thinking' });
  });

  it('handles the legacy messageChunk shape', () => {
    const { ctx, emitted } = makeContext();
    expect(handleLegacyMessageChunk({ messageChunk: { textDelta: 'x' } }, ctx).handled).toBe(true);
    expect(emitted[0]).toEqual({ type: 'model-output', textDelta: 'x' });
    expect(handleLegacyMessageChunk({}, ctx).handled).toBe(false);
  });

  it('emits plan and thinking events, and skips when the field is absent', () => {
    const { ctx, emitted } = makeContext();
    expect(handlePlanUpdate({ plan: { steps: [] } }, ctx).handled).toBe(true);
    expect(handleThinkingUpdate({ thinking: 'hmm' }, ctx).handled).toBe(true);
    expect(emitted).toContainEqual({ type: 'event', name: 'plan', payload: { steps: [] } });
    expect(emitted).toContainEqual({ type: 'event', name: 'thinking', payload: 'hmm' });
    expect(handlePlanUpdate({}, ctx).handled).toBe(false);
    expect(handleThinkingUpdate({}, ctx).handled).toBe(false);
  });
});
