import { describe, expect, it } from 'vitest';

import { computeToolMix } from './toolMixData';
import type { Message, ToolCallMessage } from '@/sync/typesMessage';

function createToolCallMessage(
  id: string,
  toolName: string,
  input: unknown,
  children: Message[] = [],
): ToolCallMessage {
  return {
    kind: 'tool-call',
    id,
    localId: null,
    createdAt: 0,
    tool: {
      name: toolName,
      state: 'completed',
      input,
      createdAt: 0,
      startedAt: 0,
      completedAt: 0,
      description: null,
    },
    children,
  };
}

describe('computeToolMix', () => {
  it('groups CodexBash tool calls by semantic command type', () => {
    const messages: Message[] = [
      createToolCallMessage('1', 'CodexBash', {
        command: 'yarn workspace happy-app typecheck',
      }),
      createToolCallMessage('2', 'CodexBash', {
        command: 'vitest --run sources/components/tools/codexCommandUtils.test.ts',
      }),
      createToolCallMessage('3', 'CodexBash', {
        command: "sed -n '1,120p' packages/happy-app/sources/components/session/SessionProgressPanel.tsx",
      }),
      createToolCallMessage('4', 'CodexBash', {
        command: 'git diff -- packages/happy-app/sources/components/session/SessionProgressPanel.tsx',
      }),
    ];

    const mix = computeToolMix(messages, 10, null);

    expect(mix.total).toBe(4);
    expect(mix.otherCount).toBe(0);
    expect(mix.segments).toEqual([
      { kind: 'semantic', name: 'git', count: 1 },
      { kind: 'semantic', name: 'read', count: 1 },
      { kind: 'semantic', name: 'test', count: 1 },
      { kind: 'semantic', name: 'verify', count: 1 },
    ]);
  });

  it('maps CodexPatch and CodexDiff into semantic buckets and keeps other tools raw', () => {
    const messages: Message[] = [
      createToolCallMessage('1', 'CodexPatch', { changes: [] }),
      createToolCallMessage('2', 'CodexDiff', { unified_diff: 'diff --git a/a.ts b/a.ts' }),
      createToolCallMessage('3', 'Read', { file_path: '/tmp/a.ts' }),
    ];

    const mix = computeToolMix(messages, 10, null);

    expect(mix.segments).toEqual([
      { kind: 'semantic', name: 'diff', count: 1 },
      { kind: 'semantic', name: 'patch', count: 1 },
      { kind: 'tool', name: 'Read', count: 1 },
    ]);
  });

  it('counts nested tool calls and collapses overflow into otherCount', () => {
    const nested = createToolCallMessage('child', 'CodexBash', {
      command: 'rg "computeToolMix" packages/happy-app/sources/components/session',
    });
    const parent = createToolCallMessage('parent', 'Task', {}, [nested]);
    const messages: Message[] = [
      parent,
      createToolCallMessage('2', 'CodexBash', { command: 'git status --short' }),
      createToolCallMessage('3', 'CodexBash', { command: 'vitest --run foo.test.ts' }),
    ];

    const mix = computeToolMix(messages, 2, null);

    expect(mix.total).toBe(4);
    expect(mix.segments).toEqual([
      { kind: 'semantic', name: 'git', count: 1 },
      { kind: 'semantic', name: 'search', count: 1 },
    ]);
    expect(mix.otherCount).toBe(2);
  });
});
