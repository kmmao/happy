import {
  getCodexParsedCommandSummary,
  getCodexCommandText,
  type CodexParsedCommandKind,
} from '@/components/tools/codexCommandUtils';
import type { Metadata } from '@/sync/storageTypes';
import type { Message, ToolCallMessage } from '@/sync/typesMessage';

const TOOL_MIX_KEY_SEPARATOR = ':';

export type ToolMixSemanticKind = CodexParsedCommandKind | 'patch' | 'diff';

export interface ToolMixSegment {
  kind: 'semantic' | 'tool';
  name: ToolMixSemanticKind | string;
  count: number;
}

export interface ToolMix {
  segments: ToolMixSegment[];
  otherSegments: ToolMixSegment[];
  otherCount: number;
  total: number;
}

function resolveToolMixSegment(
  message: ToolCallMessage,
  metadata: Metadata | null,
): Omit<ToolMixSegment, 'count'> {
  switch (message.tool.name) {
    case 'Bash': {
      const command = getCodexCommandText(
        typeof message.tool.input === 'object' && message.tool.input !== null
          ? (message.tool.input as { command?: unknown }).command
          : message.tool.input,
      );
      const summary = command
        ? getCodexParsedCommandSummary({ command }, metadata)
        : null;
      return {
        kind: 'semantic',
        name: summary?.type ?? 'run',
      };
    }
    case 'CodexBash': {
      const summary = getCodexParsedCommandSummary(message.tool.input, metadata);
      return {
        kind: 'semantic',
        name: summary?.type ?? 'unknown',
      };
    }
    case 'CodexPatch':
      return {
        kind: 'semantic',
        name: 'patch',
      };
    case 'CodexDiff':
      return {
        kind: 'semantic',
        name: 'diff',
      };
    default:
      return {
        kind: 'tool',
        name: message.tool.name || 'unknown',
      };
  }
}

function encodeToolMixSegmentKey(segment: Omit<ToolMixSegment, 'count'>): string {
  return `${segment.kind}${TOOL_MIX_KEY_SEPARATOR}${segment.name}`;
}

function decodeToolMixSegmentKey(key: string): Omit<ToolMixSegment, 'count'> {
  const separatorIndex = key.indexOf(TOOL_MIX_KEY_SEPARATOR);
  if (separatorIndex < 0) {
    return {
      kind: 'tool',
      name: key,
    };
  }

  const kind = key.slice(0, separatorIndex);
  const name = key.slice(separatorIndex + 1);
  return {
    kind: kind === 'semantic' ? 'semantic' : 'tool',
    name,
  };
}

function compareToolMixSegments(a: ToolMixSegment, b: ToolMixSegment): number {
  if (b.count !== a.count) {
    return b.count - a.count;
  }

  if (a.kind !== b.kind) {
    return a.kind === 'semantic' ? -1 : 1;
  }

  return String(a.name).localeCompare(String(b.name));
}

export function computeToolMix(
  messages: readonly Message[],
  topN: number,
  metadata: Metadata | null,
): ToolMix {
  const counts = new Map<string, number>();
  const walk = (message: Message) => {
    if (message.kind !== 'tool-call') {
      return;
    }

    const segment = resolveToolMixSegment(message, metadata);
    const key = encodeToolMixSegmentKey(segment);
    counts.set(key, (counts.get(key) ?? 0) + 1);

    for (const child of message.children) {
      walk(child);
    }
  };

  for (const message of messages) {
    walk(message);
  }

  const sorted = [...counts.entries()]
    .map(([key, count]) => ({
      ...decodeToolMixSegmentKey(key),
      count,
    }))
    .sort(compareToolMixSegments);

  const segments = sorted.slice(0, topN);
  const otherSegments = sorted.slice(topN);
  const otherCount = otherSegments.reduce((sum, segment) => sum + segment.count, 0);
  const total = sorted.reduce((sum, segment) => sum + segment.count, 0);

  return {
    segments,
    otherSegments,
    otherCount,
    total,
  };
}
