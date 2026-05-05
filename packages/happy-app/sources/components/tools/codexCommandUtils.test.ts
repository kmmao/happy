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
      rangeStart: 1,
      rangeEnd: 40,
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
        rangeStart: 1,
        rangeEnd: 40,
        extraCount: 0,
      },
    ]);
  });

  it("infers verify semantics from workspace typecheck commands", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          command: "yarn workspace happy-app typecheck",
        },
        null,
      ),
    ).toMatchObject({
      type: "verify",
      command: "yarn workspace happy-app typecheck",
      subType: "typecheck",
      manager: "yarn",
      workspace: "happy-app",
      displayName: "happy-app",
    });
  });

  it("infers test semantics from direct test runners", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          command: "vitest --run sources/components/tools/codexCommandUtils.test.ts",
        },
        null,
      ),
    ).toMatchObject({
      type: "test",
      runner: "vitest",
      displayName: "vitest",
    });
  });

  it("infers git semantics from git commands", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          command: "git diff -- packages/happy-app/sources/components/tools/codexCommandUtils.ts",
        },
        null,
      ),
    ).toMatchObject({
      type: "git",
      subType: "diff",
      displayName: "diff",
    });
  });

  it("infers package semantics from install commands", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          command: "npm install zod",
        },
        null,
      ),
    ).toMatchObject({
      type: "package",
      subType: "install",
      manager: "npm",
      displayName: "install",
    });
  });

  it("infers run semantics from long-running commands", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          command: "expo start",
        },
        null,
      ),
    ).toMatchObject({
      type: "run",
      subType: "start",
      displayName: "start",
    });
  });

  it("infers read line ranges from sed commands", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          command: "sed -n '1,220p' packages/happy-app/sources/components/tools/views/BashView.tsx",
        },
        null,
      ),
    ).toMatchObject({
      type: "read",
      rangeStart: 1,
      rangeEnd: 220,
      resolvedPath:
        "packages/happy-app/sources/components/tools/views/BashView.tsx",
      displayName: "BashView.tsx",
    });
  });

  it("infers list_files semantics from find commands", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          command: "find packages/happy-app/sources/components/tools -name \"*.tsx\"",
        },
        null,
      ),
    ).toMatchObject({
      type: "list_files",
      query: "*.tsx",
      resolvedPath: "packages/happy-app/sources/components/tools",
      displayName: "tools",
    });
  });

  it("infers git semantics from GitHub CLI commands", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          command: "gh pr view 123 --json title",
        },
        null,
      ),
    ).toMatchObject({
      type: "git",
      subType: "pr",
      displayName: "pr",
    });
  });

  it("infers write semantics from filesystem mutation commands", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          command: "mkdir -p packages/happy-app/sources/tmp",
        },
        null,
      ),
    ).toMatchObject({
      type: "write",
      resolvedPath: "packages/happy-app/sources/tmp",
      displayName: "tmp",
    });
  });

  it("infers run semantics from network and process inspection commands", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          command: "curl -s https://example.com/health",
        },
        null,
      ),
    ).toMatchObject({
      type: "run",
      subType: "script",
      displayName: "script",
    });

    expect(
      getCodexParsedCommandSummary(
        {
          command: "lsof -i :3000",
        },
        null,
      ),
    ).toMatchObject({
      type: "run",
      subType: "script",
      displayName: "script",
    });
  });

  it("infers nested semantics from package executor commands", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          command: "npx tsc --noEmit",
        },
        null,
      ),
    ).toMatchObject({
      type: "verify",
      subType: "typecheck",
      manager: "npm",
      displayName: "typecheck",
    });

    expect(
      getCodexParsedCommandSummary(
        {
          command: "bunx eslint sources",
        },
        null,
      ),
    ).toMatchObject({
      type: "verify",
      subType: "lint",
      manager: "bun",
      displayName: "lint",
    });

    expect(
      getCodexParsedCommandSummary(
        {
          command: "pnpm dlx vitest --run foo.test.ts",
        },
        null,
      ),
    ).toMatchObject({
      type: "test",
      manager: "pnpm",
      displayName: "vitest",
    });
  });

  it("infers server run semantics from docker compose commands", () => {
    expect(
      getCodexParsedCommandSummary(
        {
          command: "docker compose up -d",
        },
        null,
      ),
    ).toMatchObject({
      type: "run",
      subType: "server",
      displayName: "server",
    });
  });
});
