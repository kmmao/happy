import { describe, expect, it } from "vitest";

import {
  getCodexSourceLabelKey,
  inferCodexFileChangeKind,
} from "./codexFileChangePresentation";
import { type FileChange } from "@/components/session/codeChangeTypes";

function createFileChange(
  oldText: string,
  newText: string,
): FileChange {
  return {
    filePath: "src/example.ts",
    displayPath: "src/example.ts",
    totalAdditions: 0,
    totalDeletions: 0,
    edits: [
      {
        messageId: "message-1",
        toolName: "CodexPatch",
        editIndex: 0,
        oldText,
        newText,
      },
    ],
  };
}

describe("codexFileChangePresentation", () => {
  it("infers added files from empty old text", () => {
    expect(
      inferCodexFileChangeKind(
        createFileChange("", "export const created = true;\n"),
      ),
    ).toBe("add");
  });

  it("infers deleted files from empty new text", () => {
    expect(
      inferCodexFileChangeKind(
        createFileChange("export const removed = true;\n", ""),
      ),
    ).toBe("delete");
  });

  it("defaults to modify for edited files", () => {
    expect(
      inferCodexFileChangeKind(
        createFileChange("const value = 1;\n", "const value = 2;\n"),
      ),
    ).toBe("modify");
  });

  it("maps patch source to applyChanges label", () => {
    expect(getCodexSourceLabelKey("patch")).toBe("tools.names.applyChanges");
  });

  it("maps diff source to viewDiff label", () => {
    expect(getCodexSourceLabelKey("diff")).toBe("tools.names.viewDiff");
    expect(getCodexSourceLabelKey("none")).toBe("tools.names.viewDiff");
  });
});
