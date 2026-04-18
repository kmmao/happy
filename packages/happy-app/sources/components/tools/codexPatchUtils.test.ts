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

  it("supports Codex app-server flattened fileChange payloads", () => {
    const entries = getCodexPatchEntries({
      "src/added.ts": {
        path: "src/added.ts",
        changeType: "add",
        content: "export const added = true;\n",
      },
      "src/edited.ts": {
        path: "src/edited.ts",
        changeType: "modify",
        oldContent: "const count = 1;\n",
        newContent: "const count = 2;\n",
      },
      "src/deleted.ts": {
        path: "src/deleted.ts",
        changeType: "delete",
        oldContent: "removeMe();\n",
      },
    });

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      path: "src/added.ts",
      oldText: "",
      newText: "export const added = true;\n",
      changeType: "add",
    });
    expect(entries[1]).toMatchObject({
      path: "src/edited.ts",
      oldText: "const count = 1;\n",
      newText: "const count = 2;\n",
      changeType: "modify",
    });
    expect(entries[2]).toMatchObject({
      path: "src/deleted.ts",
      oldText: "removeMe();\n",
      newText: "",
      changeType: "delete",
    });
  });

  it("supports Codex app-server fileChange payloads with kind and diff", () => {
    const entries = getCodexPatchEntries({
      "src/updated.ts": {
        path: "src/updated.ts",
        kind: { type: "update" },
        diff: [
          "@@ -1,2 +1,3 @@",
          " const stable = true;",
          '-const status = "old";',
          '+const status = "new";',
          '+const extra = true;',
        ].join("\n"),
      },
      "src/created.ts": {
        path: "src/created.ts",
        kind: { type: "add" },
        diff: "export const created = true;\n",
      },
      "src/removed.ts": {
        path: "src/removed.ts",
        kind: { type: "delete" },
        diff: "export const removed = true;\n",
      },
    });

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      path: "src/updated.ts",
      oldText: 'const stable = true;\nconst status = "old";',
      newText: 'const stable = true;\nconst status = "new";\nconst extra = true;',
      changeType: "modify",
    });
    expect(entries[1]).toMatchObject({
      path: "src/created.ts",
      oldText: "",
      newText: "export const created = true;\n",
      changeType: "add",
    });
    expect(entries[2]).toMatchObject({
      path: "src/removed.ts",
      oldText: "export const removed = true;\n",
      newText: "",
      changeType: "delete",
    });
  });

  it("supports legacy Codex patch payloads with type and unified_diff", () => {
    const entries = getCodexPatchEntries({
      "src/legacy.ts": {
        type: "update",
        unified_diff: [
          "@@ -1,2 +1,2 @@",
          '-const mode = "old";',
          '+const mode = "new";',
          " export const ready = true;",
        ].join("\n"),
      },
    });

    expect(entries).toEqual([
      expect.objectContaining({
        path: "src/legacy.ts",
        oldText: 'const mode = "old";\nexport const ready = true;',
        newText: 'const mode = "new";\nexport const ready = true;',
        changeType: "modify",
      }),
    ]);
  });
});
