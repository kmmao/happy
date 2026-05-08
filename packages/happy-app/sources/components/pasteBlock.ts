export interface PasteBlock {
  id: string;
  text: string;
  summary: string;
  lineCount: number;
  charCount: number;
}

export interface PasteBlockThresholds {
  maxInlineLines: number;
  maxInlineChars: number;
}

export interface PasteBlockLabels {
  fallbackPreview: string;
  summary: (params: { preview: string; lines: number }) => string;
}

export const DEFAULT_PASTE_BLOCK_THRESHOLDS: PasteBlockThresholds = {
  maxInlineLines: 6,
  maxInlineChars: 800,
};

export function shouldCreatePasteBlock(
  text: string,
  thresholds: PasteBlockThresholds = DEFAULT_PASTE_BLOCK_THRESHOLDS,
): boolean {
  const normalized = text.replace(/\r\n/g, "\n");
  const lineCount = normalized.split("\n").length;
  return lineCount > thresholds.maxInlineLines || normalized.length > thresholds.maxInlineChars;
}

export function createPasteBlock(
  id: string,
  text: string,
  labels: PasteBlockLabels,
): PasteBlock {
  const normalized = text.replace(/\r\n/g, "\n");
  const lineCount = normalized.split("\n").length;
  const trimmedFirstLine = normalized
    .split("\n")
    .find((line) => line.trim().length > 0)
    ?.trim();
  const summaryPrefix = trimmedFirstLine
    ? trimmedFirstLine.slice(0, 48)
    : labels.fallbackPreview;
  return {
    id,
    text: normalized,
    summary: labels.summary({ preview: summaryPrefix, lines: lineCount }),
    lineCount,
    charCount: normalized.length,
  };
}

export function appendPasteBlocksToMessage(
  text: string,
  blocks: readonly PasteBlock[],
): string {
  return [text.trim(), ...blocks.map((block) => block.text)]
    .filter((part) => part.length > 0)
    .join("\n");
}
