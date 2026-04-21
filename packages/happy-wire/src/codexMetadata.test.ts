import { describe, expect, it } from "vitest";
import {
  CodexMetadataSchema,
  type CodexMetadata,
} from "./codexMetadata";

describe("CodexMetadataSchema", () => {
  it("parses codex runtime metadata with prompts, skills, agents, and MCP servers", () => {
    const parsed = CodexMetadataSchema.parse({
      requestedBackend: "auto",
      resolvedBackend: "codex-app-server",
      configMode: "managed-overrides",
      threadId: "thread_123",
      config: {
        model: "gpt-5.4",
        reasoningEffort: "high",
      },
      prompts: [
        {
          name: "ecc-plan",
          path: "/Users/test/.codex/prompts/ecc-plan.md",
          description: "Run the ECC planning workflow.",
        },
      ],
      skills: [
        {
          name: "tdd-workflow",
          description: "Test-driven development workflow",
          path: "/Users/test/.agents/skills/tdd-workflow/SKILL.md",
          enabled: true,
        },
      ],
      agents: [
        {
          name: "reviewer",
          path: "/Users/test/.codex/agents/reviewer.toml",
        },
      ],
      mcpServers: [
        {
          name: "happy",
          authStatus: "connected",
          toolCount: 3,
        },
      ],
    });

    expect(parsed.prompts?.[0]?.name).toBe("ecc-plan");
    expect(parsed.skills?.[0]?.enabled).toBe(true);
    expect(parsed.mcpServers?.[0]?.toolCount).toBe(3);
  });

  it("exports a reusable CodexMetadata type", () => {
    const metadata: CodexMetadata = {
      requestedBackend: "codex-mcp-legacy",
      resolvedBackend: "codex-mcp-legacy",
      configMode: "inherit",
    };

    expect(metadata.resolvedBackend).toBe("codex-mcp-legacy");
  });
});
