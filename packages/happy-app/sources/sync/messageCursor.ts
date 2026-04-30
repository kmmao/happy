interface ResolveMessageCursorAdvanceInput {
  afterSeq: number;
  rawSeqs: readonly number[];
  processedSeqs: readonly number[];
}

interface ResolveMessageCursorAdvanceResult {
  nextAfterSeq: number;
  cursorSeq: number | null;
  stalled: boolean;
  blockedByUnprocessedSeq: boolean;
}

export function resolveMessageCursorAdvance({
  afterSeq,
  rawSeqs,
  processedSeqs,
}: ResolveMessageCursorAdvanceInput): ResolveMessageCursorAdvanceResult {
  const processed = new Set(processedSeqs);
  const sortedRawSeqs = [...rawSeqs].sort((a, b) => a - b);
  let cursorSeq: number | null = null;

  for (const seq of sortedRawSeqs) {
    if (seq <= afterSeq) {
      continue;
    }
    if (!processed.has(seq)) {
      return {
        nextAfterSeq: cursorSeq ?? afterSeq,
        cursorSeq,
        stalled: cursorSeq === null,
        blockedByUnprocessedSeq: true,
      };
    }
    cursorSeq = seq;
  }

  if (cursorSeq !== null) {
    return {
      nextAfterSeq: cursorSeq,
      cursorSeq,
      stalled: false,
      blockedByUnprocessedSeq: false,
    };
  }

  return {
    nextAfterSeq: afterSeq + 1,
    cursorSeq: null,
    stalled: true,
    blockedByUnprocessedSeq: false,
  };
}
