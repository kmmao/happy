import { describe, expect, it } from "vitest";

import { extractFileChanges } from "./sidePanelCodeData";
import { ToolCallMessage } from "@/sync/typesMessage";

function makeToolCallMessage(input: {
  id: string;
  name: string;
  toolId?: string;
  state?: "running" | "completed" | "error";
  payload: Record<string, unknown>;
}): ToolCallMessage {
  return {
    kind: "tool-call",
    id: input.id,
    localId: null,
    createdAt: 1,
    children: [],
    tool: {
      id: input.toolId ?? input.id,
      name: input.name,
      state: input.state ?? "completed",
      input: input.payload,
      createdAt: 1,
      startedAt: 1,
      completedAt: 2,
      description: null,
    },
  };
}

describe("extractFileChanges", () => {
  it("keeps legacy Edit support intact", () => {
    const changes = extractFileChanges(
      [
        makeToolCallMessage({
          id: "edit-1",
          name: "Edit",
          payload: {
            file_path: "/repo/src/legacy.ts",
            old_string: "const value = 1;\n",
            new_string: "const value = 2;\n",
          },
        }),
      ],
      { path: "/repo", host: "machine" } as any,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      filePath: "/repo/src/legacy.ts",
      displayPath: "src/legacy.ts",
      totalAdditions: 1,
      totalDeletions: 1,
    });
    expect(changes[0]?.edits[0]?.toolName).toBe("Edit");
  });

  it("extracts per-file changes from CodexPatch", () => {
    const changes = extractFileChanges(
      [
        makeToolCallMessage({
          id: "patch-1",
          name: "CodexPatch",
          payload: {
            changes: {
              "/repo/src/app.ts": {
                modify: {
                  old_content: "const value = 1;\n",
                  new_content: "const value = 2;\n",
                },
              },
              "/repo/src/new.ts": {
                add: {
                  content: "export const created = true;\n",
                },
              },
            },
          },
        }),
      ],
      { path: "/repo", host: "machine" } as any,
    ).sort((a, b) => a.displayPath.localeCompare(b.displayPath));

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      filePath: "/repo/src/app.ts",
      displayPath: "src/app.ts",
      totalAdditions: 1,
      totalDeletions: 1,
    });
    expect(changes[0]?.edits[0]?.toolName).toBe("CodexPatch");

    expect(changes[1]).toMatchObject({
      filePath: "/repo/src/new.ts",
      displayPath: "src/new.ts",
      totalAdditions: 1,
      totalDeletions: 0,
    });
    expect(changes[1]?.edits[0]?.toolName).toBe("CodexPatch");
  });

  it("extracts unified diffs from CodexDiff", () => {
    const changes = extractFileChanges(
      [
        makeToolCallMessage({
          id: "diff-1",
          name: "CodexDiff",
          payload: {
            unified_diff: [
              "diff --git a/src/feature.ts b/src/feature.ts",
              "--- a/src/feature.ts",
              "+++ b/src/feature.ts",
              "@@ -1 +1 @@",
              '-console.log("old");',
              '+console.log("new");',
            ].join("\n"),
          },
        }),
      ],
      null,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      filePath: "src/feature.ts",
      displayPath: "src/feature.ts",
      totalAdditions: 1,
      totalDeletions: 1,
    });
    expect(changes[0]?.edits[0]?.toolName).toBe("CodexDiff");
  });

  it("extracts multiple files from a turn-level CodexDiff snapshot", () => {
    const changes = extractFileChanges(
      [
        makeToolCallMessage({
          id: "diff-2",
          name: "CodexDiff",
          payload: {
            unified_diff: [
              "diff --git a/src/one.ts b/src/one.ts",
              "--- a/src/one.ts",
              "+++ b/src/one.ts",
              "@@ -1 +1 @@",
              '-console.log("old one");',
              '+console.log("new one");',
              "diff --git a/src/two.ts b/src/two.ts",
              "--- a/src/two.ts",
              "+++ b/src/two.ts",
              "@@ -1 +1,2 @@",
              " export const count = 1;",
              '+export const label = "two";',
            ].join("\n"),
          },
        }),
      ],
      null,
    ).sort((a, b) => a.displayPath.localeCompare(b.displayPath));

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      filePath: "src/one.ts",
      totalAdditions: 1,
      totalDeletions: 1,
    });
    expect(changes[1]).toMatchObject({
      filePath: "src/two.ts",
      totalAdditions: 1,
      totalDeletions: 0,
    });
  });

  it("extracts Codex app-server fileChange payloads from CodexPatch", () => {
    const changes = extractFileChanges(
      [
        makeToolCallMessage({
          id: "patch-app-server-1",
          name: "CodexPatch",
          payload: {
            changes: {
              "/repo/src/edited.ts": {
                path: "/repo/src/edited.ts",
                changeType: "modify",
                oldContent: "const ready = false;\n",
                newContent: "const ready = true;\n",
              },
            },
          },
        }),
      ],
      { path: "/repo", host: "machine" } as any,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      filePath: "/repo/src/edited.ts",
      displayPath: "src/edited.ts",
      totalAdditions: 1,
      totalDeletions: 1,
    });
    expect(changes[0]?.edits[0]?.toolName).toBe("CodexPatch");
  });

  it("extracts official app-server kind/diff payloads from CodexPatch", () => {
    const changes = extractFileChanges(
      [
        makeToolCallMessage({
          id: "patch-kind-diff-1",
          name: "CodexPatch",
          payload: {
            changes: {
              "/repo/src/edited.ts": {
                path: "/repo/src/edited.ts",
                kind: { type: "update" },
                diff: [
                  "@@ -1,2 +1,3 @@",
                  " const stable = true;",
                  '-const status = "old";',
                  '+const status = "new";',
                  '+const extra = true;',
                ].join("\n"),
              },
            },
          },
        }),
      ],
      { path: "/repo", host: "machine" } as any,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      filePath: "/repo/src/edited.ts",
      displayPath: "src/edited.ts",
      totalAdditions: 2,
      totalDeletions: 1,
    });
    expect(changes[0]?.edits[0]).toMatchObject({
      toolName: "CodexPatch",
      oldText: 'const stable = true;\nconst status = "old";',
      newText: 'const stable = true;\nconst status = "new";\nconst extra = true;',
    });
  });

  it("prefers CodexPatch file changes over redundant CodexDiff snapshots", () => {
    const changes = extractFileChanges(
      [
        makeToolCallMessage({
          id: "patch-priority-1",
          name: "CodexPatch",
          payload: {
            changes: {
              "/repo/src/app.ts": {
                modify: {
                  old_content: "const value = 1;\n",
                  new_content: "const value = 2;\n",
                },
              },
            },
          },
        }),
        makeToolCallMessage({
          id: "diff-priority-1",
          name: "CodexDiff",
          payload: {
            unified_diff: [
              "diff --git a/repo/src/app.ts b/repo/src/app.ts",
              "--- a/repo/src/app.ts",
              "+++ b/repo/src/app.ts",
              "@@ -1 +1 @@",
              "-const value = 1;",
              "+const value = 2;",
            ].join("\n"),
          },
        }),
      ],
      { path: "/repo", host: "machine" } as any,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      filePath: "/repo/src/app.ts",
      displayPath: "src/app.ts",
      totalAdditions: 1,
      totalDeletions: 1,
    });
    expect(changes[0]?.edits).toHaveLength(1);
    expect(changes[0]?.edits[0]?.toolName).toBe("CodexPatch");
  });
});
