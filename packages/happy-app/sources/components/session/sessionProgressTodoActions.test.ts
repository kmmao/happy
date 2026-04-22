import { describe, expect, it, vi } from "vitest";

vi.mock("@/text", () => ({
  t: (key: string, params?: { content?: string }) => {
    const content = params?.content ?? "";
    const table: Record<string, string> = {
      "session.progressTodoActionMessage": "Choose an action for this item",
      "session.progressTodoActionVerify": "Verify",
      "session.progressTodoActionContinue": "Continue",
      "session.progressTodoActionIssue": "Report issue",
      "common.cancel": "Cancel",
      "session.progressTodoPromptVerifyCompleted": `Please verify whether "${content}" is actually complete. Cite evidence (files, tests, commands). If it is not complete, rewrite your TodoWrite checklist so the status reflects reality.`,
      "session.progressTodoPromptVerifyActive": `Please verify the current state of "${content}". Cite the latest evidence (files, tests, commands). If the status is wrong or blockers exist, rewrite your TodoWrite checklist so it reflects reality.`,
      "session.progressTodoPromptContinueTodoWrite": `Please continue working on "${content}" from the current state. When the status changes or blockers appear, rewrite your TodoWrite checklist so the Progress tab stays accurate.`,
      "session.progressTodoPromptIssueCompleted": `I think "${content}" was marked completed too early. Re-check it, explain what is still missing, and rewrite your TodoWrite checklist if the status should change.`,
      "session.progressTodoPromptIssueActive": `I think the current status of "${content}" is wrong or incomplete. Re-evaluate it, explain the issue or blocker, and rewrite your TodoWrite checklist if needed.`,
      "session.progressTodoPromptVerifyCompletedCodex": `Please verify whether "${content}" is actually complete. Cite evidence (files, tests, commands). If it is not complete, call mcp__happy__update_progress to correct the checklist status.`,
      "session.progressTodoPromptVerifyActiveCodex": `Please verify the current state of "${content}". Cite the latest evidence (files, tests, commands). If the status is wrong or blockers exist, call mcp__happy__update_progress to correct the checklist, blockers, or currentStage.`,
      "session.progressTodoPromptContinueCodex": `Please continue working on "${content}" from the current state. When the status changes or blockers appear, call mcp__happy__update_progress so the Progress tab stays accurate.`,
      "session.progressTodoPromptIssueCompletedCodex": `I think "${content}" was marked completed too early. Re-check it, explain what is still missing, and call mcp__happy__update_progress if the status should change.`,
      "session.progressTodoPromptIssueActiveCodex": `I think the current status of "${content}" is wrong or incomplete. Re-evaluate it, explain the issue or blocker, and call mcp__happy__update_progress if needed.`,
    };
    return table[key] ?? key;
  },
}));

import type { ProgressTodo } from "./sessionProgressData";
import { buildProgressTodoActionSheet } from "./sessionProgressTodoActions";

function makeTodo(
  overrides: Partial<ProgressTodo> & Pick<ProgressTodo, "content" | "status">,
): ProgressTodo {
  return {
    content: overrides.content,
    status: overrides.status,
    activeForm: overrides.activeForm,
    verificationNudgeNeeded: overrides.verificationNudgeNeeded,
    priority: overrides.priority,
    id: overrides.id,
  };
}

describe("buildProgressTodoActionSheet", () => {
  it("builds Claude/TodoWrite-oriented prompts for completed items", () => {
    const appendToInput = vi.fn();
    const sheet = buildProgressTodoActionSheet({
      todo: makeTodo({ content: "Patch parser", status: "completed" }),
      flavor: "claude",
      appendToInput,
    });

    expect(sheet.message).toBe("Choose an action for this item");
    expect(sheet.buttons.map((button) => button.text)).toEqual([
      "Verify",
      "Report issue",
      "Cancel",
    ]);

    sheet.buttons[0]?.onPress?.();
    expect(appendToInput).toHaveBeenCalledWith(
      expect.stringContaining("rewrite your TodoWrite checklist"),
    );
    expect(appendToInput).not.toHaveBeenCalledWith(
      expect.stringContaining("mcp__happy__update_progress"),
    );
  });

  it("builds Codex/MCP-oriented prompts for active items", () => {
    const appendToInput = vi.fn();
    const sheet = buildProgressTodoActionSheet({
      todo: makeTodo({ content: "Run tests", status: "in_progress" }),
      flavor: "codex",
      appendToInput,
    });

    expect(sheet.buttons.map((button) => button.text)).toEqual([
      "Verify",
      "Continue",
      "Report issue",
      "Cancel",
    ]);

    sheet.buttons[1]?.onPress?.();
    expect(appendToInput).toHaveBeenCalledWith(
      expect.stringContaining('Please continue working on "Run tests"'),
    );
    expect(appendToInput).toHaveBeenCalledWith(
      expect.stringContaining("mcp__happy__update_progress"),
    );
  });

  it("omits verify for pending items and uses active-issue wording", () => {
    const appendToInput = vi.fn();
    const sheet = buildProgressTodoActionSheet({
      todo: makeTodo({ content: "Inspect logs", status: "pending" }),
      flavor: "claude",
      appendToInput,
    });

    expect(sheet.buttons.map((button) => button.text)).toEqual([
      "Continue",
      "Report issue",
      "Cancel",
    ]);

    sheet.buttons[1]?.onPress?.();
    expect(appendToInput).toHaveBeenCalledWith(
      expect.stringContaining('current status of "Inspect logs" is wrong or incomplete'),
    );
    expect(appendToInput).not.toHaveBeenCalledWith(
      expect.stringContaining("marked completed too early"),
    );
  });
});
