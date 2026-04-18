import { type DiffPalette } from "@/components/diff/DiffView";

interface CodexDiffColors {
  codeBg: string;
  codeBorder: string;
  diff: {
    addedBg: string;
    addedText: string;
    removedBg: string;
    removedText: string;
    contextBg: string;
    contextText: string;
    gutterBg: string;
    gutterText: string;
    hunkBg: string;
    hunkText: string;
    inlineAddedBg: string;
    inlineRemovedBg: string;
  };
}

export function buildCodexDiffPalette(colors: CodexDiffColors): DiffPalette {
  return {
    surface: colors.codeBg,
    diff: {
      outline: colors.codeBorder,
      addedBg: colors.diff.addedBg,
      addedText: colors.diff.addedText,
      removedBg: colors.diff.removedBg,
      removedText: colors.diff.removedText,
      contextBg: colors.diff.contextBg,
      contextText: colors.diff.contextText,
      lineNumberBg: colors.diff.gutterBg,
      lineNumberText: colors.diff.gutterText,
      hunkHeaderBg: colors.diff.hunkBg,
      hunkHeaderText: colors.diff.hunkText,
      leadingSpaceDot: colors.diff.gutterText,
      inlineAddedBg: colors.diff.inlineAddedBg,
      inlineAddedText: colors.diff.addedText,
      inlineRemovedBg: colors.diff.inlineRemovedBg,
      inlineRemovedText: colors.diff.removedText,
    },
  };
}
