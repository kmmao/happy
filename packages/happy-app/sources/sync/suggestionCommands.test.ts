import { beforeEach, describe, expect, it, vi } from "vitest";

let mockState: { sessions: Record<string, any> } = { sessions: {} };

vi.mock("./storage", () => ({
  storage: {
    getState: () => mockState,
  },
}));

import { getAllCommands } from "./suggestionCommands";

describe("getAllCommands", () => {
  beforeEach(() => {
    mockState = { sessions: {} };
  });

  it("includes Codex prompt entries even when slashCommands are absent", () => {
    mockState = {
      sessions: {
        "codex-session": {
          metadata: {
            path: "/tmp/project",
            host: "test-host",
            flavor: "codex",
            codex: {
              prompts: [
                {
                  name: "ecc-plan",
                  path: "/Users/test/.codex/prompts/ecc-plan.md",
                  description: "Run the ECC planning workflow.",
                },
              ],
            },
          },
        },
      },
    };

    expect(getAllCommands("codex-session")).toEqual([
      { command: "compact", description: "Compact the conversation history", kind: "slash", source: "builtin" },
      { command: "clear", description: "Clear the conversation", kind: "slash", source: "builtin" },
      {
        command: "ecc-plan",
        description: "Run the ECC planning workflow.",
        kind: "slash",
        source: "codex",
      },
    ]);
  });

  it("dedupes Codex prompts against slashCommands", () => {
    mockState = {
      sessions: {
        "codex-session": {
          metadata: {
            path: "/tmp/project",
            host: "test-host",
            flavor: "codex",
            slashCommands: ["ecc-plan"],
            slashCommandDescriptions: {
              "ecc-plan": "Slash metadata description",
            },
            codex: {
              prompts: [
                {
                  name: "ecc-plan",
                  path: "/Users/test/.codex/prompts/ecc-plan.md",
                  description: "Prompt metadata description",
                },
              ],
            },
          },
        },
      },
    };

    expect(
      getAllCommands("codex-session").filter(
        (command) => command.command === "ecc-plan",
      ),
    ).toEqual([
      {
        command: "ecc-plan",
        description: "Prompt metadata description",
        kind: "slash",
        source: "codex",
      },
    ]);
  });

  it("keeps non-prompt slash commands alongside Codex prompts", () => {
    mockState = {
      sessions: {
        "codex-session": {
          metadata: {
            path: "/tmp/project",
            host: "test-host",
            flavor: "codex",
            slashCommands: ["ecc-plan", "plan"],
            slashCommandDescriptions: {
              plan: "Generic planner command",
            },
            codex: {
              prompts: [
                {
                  name: "ecc-plan",
                  path: "/Users/test/.codex/prompts/ecc-plan.md",
                  description: "Prompt metadata description",
                },
              ],
            },
          },
        },
      },
    };

    expect(getAllCommands("codex-session")).toEqual([
      { command: "compact", description: "Compact the conversation history", kind: "slash", source: "builtin" },
      { command: "clear", description: "Clear the conversation", kind: "slash", source: "builtin" },
      {
        command: "plan",
        description: "Generic planner command",
        kind: "slash",
        source: "unknown",
      },
      {
        command: "ecc-plan",
        description: "Prompt metadata description",
        kind: "slash",
        source: "codex",
      },
    ]);
  });

  it("includes Codex skills as skill shortcuts", () => {
    mockState = {
      sessions: {
        "codex-session": {
          metadata: {
            path: "/tmp/project",
            host: "test-host",
            flavor: "codex",
            codex: {
              skills: [
                {
                  name: "tdd",
                  path: "/Users/test/.agents/skills/tdd/SKILL.md",
                  description: "Test-driven development workflow",
                  enabled: true,
                },
              ],
            },
          },
        },
      },
    };

    expect(getAllCommands("codex-session")).toContainEqual({
      command: "tdd",
      description: "Test-driven development workflow",
      kind: "skill",
      source: "codex",
    });
  });

  it("prefers slashCommandsRich (with source tags) over the flat slashCommands list", () => {
    mockState = {
      sessions: {
        "claude-session": {
          metadata: {
            path: "/tmp/project",
            host: "test-host",
            slashCommands: ["deploy", "codex:rescue"],
            slashCommandDescriptions: {
              deploy: "ignored description",
            },
            slashCommandsRich: [
              {
                name: "deploy",
                description: "Deploy project",
                source: "project",
                kind: "command",
              },
              {
                name: "codex:rescue",
                description: "Codex rescue",
                source: "plugin",
                kind: "command",
                plugin: "codex",
              },
            ],
          },
        },
      },
    };

    const result = getAllCommands("claude-session");
    expect(result).toContainEqual({
      command: "deploy",
      description: "Deploy project",
      kind: "slash",
      source: "project",
    });
    expect(result).toContainEqual({
      command: "codex:rescue",
      description: "Codex rescue",
      kind: "slash",
      source: "plugin",
      plugin: "codex",
    });
  });

  it("infers plugin source from `<plugin>:<name>` shape on the flat fallback path", () => {
    mockState = {
      sessions: {
        "claude-session": {
          metadata: {
            path: "/tmp/project",
            host: "test-host",
            // No slashCommandsRich — simulates older CLI.
            slashCommands: ["deploy", "codex:rescue"],
          },
        },
      },
    };

    const result = getAllCommands("claude-session");
    expect(result).toContainEqual({
      command: "deploy",
      description: undefined,
      kind: "slash",
      source: "unknown",
    });
    expect(result).toContainEqual({
      command: "codex:rescue",
      description: undefined,
      kind: "slash",
      source: "plugin",
      plugin: "codex",
    });
  });
});
