import { describe, expect, it } from "vitest";

import {
  buildDiffStatsTheme,
  type DiffStatsThemeInput,
} from "@/components/diff/diffStatsTheme";

const themeInput: DiffStatsThemeInput = {
  colors: {
    diff: {
      success: "#28A745",
      error: "#DC3545",
    },
    codex: {
      changeKind: {
        add: "#16A34A",
        delete: "#DC2626",
      },
      borderSoft: "#E4E8F1",
    },
  },
  codex: {
    spacing: {
      cardGap: 10,
    },
    radius: {
      chip: 999,
    },
  },
};

describe("buildDiffStatsTheme", () => {
  it("returns legacy diff tokens for default provider", () => {
    expect(buildDiffStatsTheme("default", themeInput)).toEqual({
      additionsColor: "#28A745",
      deletionsColor: "#DC3545",
      trackColor: null,
      marginLeft: 8,
      radius: 3,
    });
  });

  it("returns Code X tokens for codex provider", () => {
    expect(buildDiffStatsTheme("codex", themeInput)).toEqual({
      additionsColor: "#16A34A",
      deletionsColor: "#DC2626",
      trackColor: "#E4E8F1",
      marginLeft: 8,
      radius: 999,
    });
  });
});
