import { describe, expect, it } from "vitest";

import { getToolProvider } from "@/components/tools/toolProvider";

describe("getToolProvider", () => {
  it("returns codex when metadata flavor is codex", () => {
    expect(
      getToolProvider({
        toolName: "Bash",
        metadata: { flavor: "codex" } as any,
      }),
    ).toBe("codex");
  });

  it("returns codex when tool name has Codex prefix", () => {
    expect(
      getToolProvider({
        toolName: "CodexPatch",
        metadata: null,
      }),
    ).toBe("codex");
  });

  it("returns default for non-codex tools without codex flavor", () => {
    expect(
      getToolProvider({
        toolName: "Bash",
        metadata: { flavor: "claude" } as any,
      }),
    ).toBe("default");
  });
});
