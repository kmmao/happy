import { describe, expect, it } from "vitest";
import {
  getCodexCommandPreview,
  getCodexCommandText,
} from "./codexCommandUtils";

describe("codexCommandUtils", () => {
  it("unwraps shell-wrapped string commands", () => {
    expect(
      getCodexCommandText(
        `/bin/zsh -lc "sed -n '1,220p' /tmp/example.ts"`,
      ),
    ).toBe(`sed -n '1,220p' /tmp/example.ts`);
  });

  it("keeps plain commands unchanged", () => {
    expect(getCodexCommandText("ls -la")).toBe("ls -la");
  });

  it("joins array commands", () => {
    expect(getCodexCommandText(["bash", "-lc", "pwd"])).toBe("pwd");
  });

  it("truncates long previews", () => {
    expect(getCodexCommandPreview("abcdefghijklmnopqrstuvwxyz", 10)).toBe(
      "abcdefg...",
    );
  });
});
