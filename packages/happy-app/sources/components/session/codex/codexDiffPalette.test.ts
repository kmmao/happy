import { describe, expect, it } from "vitest";

import { buildCodexDiffPalette } from "@/components/session/codex/codexDiffPalette";
import { codexDarkColors, codexLightColors } from "@/themeCodex";

describe("buildCodexDiffPalette", () => {
  it("maps Code X light tokens into DiffView palette fields", () => {
    expect(buildCodexDiffPalette(codexLightColors)).toEqual({
      surface: codexLightColors.codeBg,
      diff: {
        outline: codexLightColors.codeBorder,
        addedBg: codexLightColors.diff.addedBg,
        addedText: codexLightColors.diff.addedText,
        removedBg: codexLightColors.diff.removedBg,
        removedText: codexLightColors.diff.removedText,
        contextBg: codexLightColors.diff.contextBg,
        contextText: codexLightColors.diff.contextText,
        lineNumberBg: codexLightColors.diff.gutterBg,
        lineNumberText: codexLightColors.diff.gutterText,
        hunkHeaderBg: codexLightColors.diff.hunkBg,
        hunkHeaderText: codexLightColors.diff.hunkText,
        leadingSpaceDot: codexLightColors.diff.gutterText,
        inlineAddedBg: codexLightColors.diff.inlineAddedBg,
        inlineAddedText: codexLightColors.diff.addedText,
        inlineRemovedBg: codexLightColors.diff.inlineRemovedBg,
        inlineRemovedText: codexLightColors.diff.removedText,
      },
    });
  });

  it("maps Code X dark tokens into DiffView palette fields", () => {
    expect(buildCodexDiffPalette(codexDarkColors)).toEqual({
      surface: codexDarkColors.codeBg,
      diff: {
        outline: codexDarkColors.codeBorder,
        addedBg: codexDarkColors.diff.addedBg,
        addedText: codexDarkColors.diff.addedText,
        removedBg: codexDarkColors.diff.removedBg,
        removedText: codexDarkColors.diff.removedText,
        contextBg: codexDarkColors.diff.contextBg,
        contextText: codexDarkColors.diff.contextText,
        lineNumberBg: codexDarkColors.diff.gutterBg,
        lineNumberText: codexDarkColors.diff.gutterText,
        hunkHeaderBg: codexDarkColors.diff.hunkBg,
        hunkHeaderText: codexDarkColors.diff.hunkText,
        leadingSpaceDot: codexDarkColors.diff.gutterText,
        inlineAddedBg: codexDarkColors.diff.inlineAddedBg,
        inlineAddedText: codexDarkColors.diff.addedText,
        inlineRemovedBg: codexDarkColors.diff.inlineRemovedBg,
        inlineRemovedText: codexDarkColors.diff.removedText,
      },
    });
  });
});
