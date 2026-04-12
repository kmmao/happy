import { describe, expect, it, vi } from "vitest";
import { queryProjectKnowledge } from "./startHappyServer";

describe("queryProjectKnowledge", () => {
  it("returns a no-results message when no knowledge entries are found", async () => {
    const client = {
      fetchKnowledge: vi.fn(async () => ({
        profile: null,
        entries: [],
        actionItems: [],
      })),
    };

    const result = await queryProjectKnowledge(client as any, "auth flow");

    expect(client.fetchKnowledge).toHaveBeenCalledWith("auto", ["auth flow"]);
    expect(result).toEqual({
      content: [{ type: "text", text: "No relevant knowledge found." }],
      isError: false,
    });
  });

  it("formats matching knowledge entries into text content", async () => {
    const client = {
      fetchKnowledge: vi.fn(async () => ({
        profile: null,
        entries: [
          {
            id: "k1",
            entryType: "fix",
            title: "Token refresh bug",
            content: "Refresh token rotation must happen before session save.",
            tags: ["auth"],
            confidence: "high",
            createdAt: "2026-04-13",
          },
          {
            id: "k2",
            entryType: "convention",
            title: "No silent failures",
            content: "Tool call failures must always surface visible UI feedback.",
            tags: ["ux"],
            confidence: "medium",
            createdAt: "2026-04-12",
          },
        ],
        actionItems: [],
      })),
    };

    const result = await queryProjectKnowledge(client as any, "tool failures");

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain("[fix] Token refresh bug (high)");
    expect(result.content[0]?.text).toContain(
      "Refresh token rotation must happen before session save.",
    );
    expect(result.content[0]?.text).toContain(
      "[convention] No silent failures (medium)",
    );
  });

  it("returns an error message when the knowledge query fails", async () => {
    const client = {
      fetchKnowledge: vi.fn(async () => {
        throw new Error("socket offline");
      }),
    };

    const result = await queryProjectKnowledge(client as any, "project history");

    expect(result).toEqual({
      content: [{ type: "text", text: "Knowledge query failed." }],
      isError: true,
    });
  });
});
