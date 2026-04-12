import { describe, expect, it } from "vitest";
import {
  getCodexCommandPreview,
  getCodexCommandText,
  getCodexParsedCommandSummary,
  getCodexParsedCommandSummaries,
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

  it("extracts search semantics from parsed_cmd", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          parsed_cmd: [
            {
              type: "search",
              cmd: "rg -n \"foo\" src -S",
              query: "foo",
              path: "src",
            },
          ],
        },
        null,
      ),
    ).toEqual({
      type: "search",
      command: "rg -n \"foo\" src -S",
      query: "foo",
      resolvedPath: "src",
      displayName: "src",
      extraCount: 0,
    });
  });

  it("extracts read semantics from parsed_cmd", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          parsed_cmd: [
            {
              type: "read",
              cmd: "sed -n '1,40p' /tmp/example.ts",
              name: "/tmp/example.ts",
            },
          ],
        },
        null,
      ),
    ).toEqual({
      type: "read",
      command: "sed -n '1,40p' /tmp/example.ts",
      query: null,
      resolvedPath: "/tmp/example.ts",
      displayName: "example.ts",
      extraCount: 0,
    });
  });

  it("returns summaries for multiple parsed commands", () => {
    expect(
      getCodexParsedCommandSummaries(
        {
          parsed_cmd: [
            {
              type: "search",
              cmd: "rg -n \"foo\" src -S",
              query: "foo",
              path: "src",
            },
            {
              type: "read",
              cmd: "sed -n '1,40p' /tmp/example.ts",
              name: "/tmp/example.ts",
            },
          ],
        },
        null,
      ),
    ).toEqual([
      {
        type: "search",
        command: "rg -n \"foo\" src -S",
        query: "foo",
        resolvedPath: "src",
        displayName: "src",
        extraCount: 0,
      },
      {
        type: "read",
        command: "sed -n '1,40p' /tmp/example.ts",
        query: null,
        resolvedPath: "/tmp/example.ts",
        displayName: "example.ts",
        extraCount: 0,
      },
    ]);
  });
});
