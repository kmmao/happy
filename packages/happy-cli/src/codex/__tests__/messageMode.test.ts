import { describe, expect, it } from 'vitest';
import type { MessageMeta } from '@/api/types';
import { hashCodexMode, resolveCodexMessageMode } from '../messageMode';

describe('resolveCodexMessageMode', () => {
  it('applies message-level reasoning effort overrides', () => {
    const result = resolveCodexMessageMode({
      current: {
        permissionMode: 'read-only',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
      },
      meta: {
        effort: 'low',
      } as MessageMeta,
    });

    expect(result.mode).toEqual({
      permissionMode: 'read-only',
      model: 'gpt-5.4',
      reasoningEffort: 'low',
    });
    expect(result.next).toEqual({
      permissionMode: 'read-only',
      model: 'gpt-5.4',
      reasoningEffort: 'low',
    });
  });

  it('clears persisted reasoning effort when the message explicitly resets it', () => {
    const result = resolveCodexMessageMode({
      current: {
        permissionMode: 'default',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
      },
      meta: {
        effort: null,
      } as MessageMeta,
    });

    expect(result.mode).toEqual({
      permissionMode: 'default',
      model: 'gpt-5.4',
      reasoningEffort: undefined,
    });
    expect(result.next.reasoningEffort).toBeUndefined();
  });
});

describe('hashCodexMode', () => {
  it('treats reasoning effort as part of the mode identity', () => {
    expect(
      hashCodexMode({
        permissionMode: 'default',
        model: 'gpt-5.4',
      }),
    ).not.toBe(
      hashCodexMode({
        permissionMode: 'default',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
      }),
    );
  });
});
