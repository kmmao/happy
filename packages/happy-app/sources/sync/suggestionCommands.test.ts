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
      { command: "compact", description: "Compact the conversation history", kind: "slash" },
      { command: "clear", description: "Clear the conversation", kind: "slash" },
      {
        command: "ecc-plan",
        description: "Run the ECC planning workflow.",
        kind: "slash",
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
      { command: "compact", description: "Compact the conversation history", kind: "slash" },
      { command: "clear", description: "Clear the conversation", kind: "slash" },
      {
        command: "plan",
        description: "Generic planner command",
        kind: "slash",
      },
      {
        command: "ecc-plan",
        description: "Prompt metadata description",
        kind: "slash",
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
    });
  });

});
