import type { AlertButton } from "@/modal/types";
import { t } from "@/text";

import type { ProgressTodo } from "./sessionProgressData";
import { getProgressTodoPromptKey } from "./sessionProgressPrompts";

interface BuildProgressTodoActionSheetArgs {
  todo: ProgressTodo;
  flavor: string | null | undefined;
  appendToInput: (text: string) => void;
}

interface ProgressTodoActionSheet {
  title: string;
  message: string;
  buttons: AlertButton[];
}

function buildProgressTodoPrompt(
  flavor: string | null | undefined,
  todo: ProgressTodo,
  action: "verify" | "continue" | "issue",
): string {
  return t(getProgressTodoPromptKey(flavor, todo.status, action), {
    content: todo.content,
  });
}

export function buildProgressTodoActionSheet(
  args: BuildProgressTodoActionSheetArgs,
): ProgressTodoActionSheet {
  const { todo, flavor, appendToInput } = args;
  const showVerify = todo.status !== "pending";
  const showContinue = todo.status !== "completed";

  const buttons: AlertButton[] = [
    ...(showVerify
      ? [
          {
            text: t("session.progressTodoActionVerify"),
            onPress: () =>
              appendToInput(buildProgressTodoPrompt(flavor, todo, "verify")),
          } satisfies AlertButton,
        ]
      : []),
    ...(showContinue
      ? [
          {
            text: t("session.progressTodoActionContinue"),
            onPress: () =>
              appendToInput(buildProgressTodoPrompt(flavor, todo, "continue")),
          } satisfies AlertButton,
        ]
      : []),
    {
      text: t("session.progressTodoActionIssue"),
      style: "destructive",
      onPress: () =>
        appendToInput(buildProgressTodoPrompt(flavor, todo, "issue")),
    },
    {
      text: t("common.cancel"),
      style: "cancel",
    },
  ];

  return {
    title:
      todo.content.length > 80 ? `${todo.content.slice(0, 79)}…` : todo.content,
    message: t("session.progressTodoActionMessage"),
    buttons,
  };
}
