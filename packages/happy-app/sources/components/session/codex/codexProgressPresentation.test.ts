import { describe, expect, it } from "vitest";

import { resolveCodexPlanData, getCodexPlanSourceLabelKey } from "./codexProgressPresentation";
import { type ResolvedChecklist } from "@/components/session/sessionProgressData";
import { type Message } from "@/sync/typesMessage";

function createChecklist(
  overrides: Partial<ResolvedChecklist> = {},
): ResolvedChecklist {
  return {
    source: "none",
    todos: [],
    updatedAt: null,
    ...overrides,
  };
}

function createAgentTextMessage(text: string, createdAt: number): Message {
  return {
    kind: "agent-text",
    id: `message-${createdAt}`,
    localId: null,
    createdAt,
    text,
  };
}

describe("codexProgressPresentation", () => {
  it("prefers resolved checklist data over legacy previews", () => {
    const plan = resolveCodexPlanData(
      createChecklist({
        source: "mcp",
        updatedAt: 123,
        currentStage: "Review parser coverage",
        todos: [
          {
            content: "Parse official fileChange payloads",
            status: "completed",
          },
        ],
      }),
      [
        createAgentTextMessage(
          [
            "Older plan preview",
            "[pending] stale step",
          ].join("\n"),
          10,
        ),
      ],
    );

    expect(plan).toMatchObject({
      source: "mcp",
      updatedAt: 123,
      currentStage: "Review parser coverage",
      todos: [
        {
          content: "Parse official fileChange payloads",
          status: "completed",
        },
      ],
    });
  });

  it("falls back to the latest legacy Codex plan preview when checklist is empty", () => {
    const plan = resolveCodexPlanData(
      createChecklist(),
      [
        createAgentTextMessage(
          [
            "Initial preview",
            "[pending] stale step",
          ].join("\n"),
          10,
        ),
        createAgentTextMessage(
          [
            "Current rollout",
            "[completed] Parse diff payloads",
            "[in_progress] Build Code X cards",
            "[pending] Follow-up validation",
          ].join("\n"),
          20,
        ),
      ],
    );

    expect(plan).toMatchObject({
      source: "legacy_preview",
      updatedAt: 20,
      explanation: "Current rollout",
      todos: [
        {
          content: "Parse diff payloads",
          status: "completed",
        },
        {
          content: "Build Code X cards",
          status: "in_progress",
        },
        {
          content: "Follow-up validation",
          status: "pending",
        },
      ],
    });
  });

  it("returns an empty model when neither checklist nor preview exists", () => {
    expect(resolveCodexPlanData(createChecklist(), [])).toEqual({
      source: "none",
      todos: [],
      updatedAt: null,
    });
  });

  it("keeps an explicitly empty checklist instead of reviving a stale legacy preview", () => {
    const plan = resolveCodexPlanData(
      createChecklist({
        source: "mcp",
        listId: "list-1",
        label: "Current phase",
        updatedAt: 30,
        currentStage: "Waiting for confirmation",
        todos: [],
      }),
      [
        createAgentTextMessage(
          [
            "Old preview",
            "[in_progress] stale fallback",
          ].join("\n"),
          10,
        ),
      ],
    );

    expect(plan).toEqual({
      source: "mcp",
      listId: "list-1",
      todos: [],
      updatedAt: 30,
      label: "Current phase",
      currentStage: "Waiting for confirmation",
      blockers: undefined,
      explanation: undefined,
    });
  });

  it("maps source labels for specialized plan chips", () => {
    expect(getCodexPlanSourceLabelKey("mcp")).toBe("session.progressSourceMcp");
    expect(getCodexPlanSourceLabelKey("todowrite")).toBe(
      "session.progressSourceTodoWrite",
    );
    expect(getCodexPlanSourceLabelKey("legacy_preview")).toBe(
      "tools.names.planProposal",
    );
    expect(getCodexPlanSourceLabelKey("none")).toBe("tools.names.planProposal");
  });
});
