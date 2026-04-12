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
      { command: "compact", description: "Compact the conversation history" },
      { command: "clear", description: "Clear the conversation" },
      {
        command: "ecc-plan",
        description: "Run the ECC planning workflow.",
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
        description: "Slash metadata description",
      },
    ]);
  });
});
