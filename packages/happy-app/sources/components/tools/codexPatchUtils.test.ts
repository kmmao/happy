import { describe, expect, it } from "vitest";
import {
  getCodexPatchEntries,
  getCodexPatchTotals,
} from "./codexPatchUtils";

describe("codexPatchUtils", () => {
  it("normalizes add/modify/delete changes into diff entries", () => {
    const entries = getCodexPatchEntries({
      "src/new.ts": {
        add: {
          content: "const value = 1;\n",
        },
      },
      "src/edit.ts": {
        modify: {
          old_content: "const value = 1;\n",
          new_content: "const value = 2;\nconst next = 3;\n",
        },
      },
      "src/remove.ts": {
        delete: {
          content: "obsolete();\n",
        },
      },
    });

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      path: "src/new.ts",
      oldText: "",
      newText: "const value = 1;\n",
      changeType: "add",
    });
    expect(entries[1]).toMatchObject({
      path: "src/edit.ts",
      oldText: "const value = 1;\n",
      newText: "const value = 2;\nconst next = 3;\n",
      changeType: "modify",
    });
    expect(entries[2]).toMatchObject({
      path: "src/remove.ts",
      oldText: "obsolete();\n",
      newText: "",
      changeType: "delete",
    });
  });

  it("computes aggregate diff totals", () => {
    const totals = getCodexPatchTotals(
      getCodexPatchEntries({
        "src/edit.ts": {
          modify: {
            old_content: "a\n",
            new_content: "a\nb\n",
          },
        },
        "src/remove.ts": {
          delete: {
            content: "c\n",
          },
        },
      }),
    );

    expect(totals).toEqual({
      additions: 1,
      deletions: 1,
    });
  });
});
