import * as React from "react";
import { ToolCall } from "@/sync/typesMessage";
import { isReviewableTool } from "@/components/tools/knownTools";
import { storage, useToolReviewState } from "@/sync/storage";
import { sync } from "@/sync/sync";
import { Modal } from "@/modal/ModalManager";
import { t } from "@/text";

interface UseToolReviewParams {
  tool: ToolCall;
  messageId?: string;
  sessionId?: string;
}

interface UseToolReviewResult {
  isReviewable: boolean;
  reviewState: "accepted" | "rejected" | undefined;
  onAccept: () => void;
  onReject: () => void;
}

export function useToolReview({
  tool,
  messageId,
  sessionId,
}: UseToolReviewParams): UseToolReviewResult {
  const reviewState = useToolReviewState(messageId);

  const isReviewable =
    tool.state === "completed" &&
    isReviewableTool(tool.name) &&
    tool.permission?.status !== "pending" &&
    !!sessionId &&
    !!messageId;

  const onAccept = React.useCallback(() => {
    if (!messageId) return;
    storage.getState().setToolReview(messageId, "accepted");
  }, [messageId]);

  const onReject = React.useCallback(() => {
    if (!messageId || !sessionId) return;

    const filePath =
      typeof tool.input?.file_path === "string" ? tool.input.file_path : null;

    const confirmMessage = filePath
      ? t("codeReview.rejectConfirmMessage", { filePath })
      : t("codeReview.rejectConfirmTitle");

    Modal.alert(t("codeReview.rejectConfirmTitle"), confirmMessage, [
      {
        text: t("codeReview.rejectConfirm"),
        onPress: () => {
          storage.getState().setToolReview(messageId, "rejected");

          const revertMessage = filePath
            ? `Please revert the edit to \`${filePath}\`. I reviewed the change and want it undone.`
            : `Please revert the last edit. I reviewed the change and want it undone.`;

          sync.sendMessage(sessionId, revertMessage);
        },
      },
      { text: t("common.cancel") },
    ]);
  }, [messageId, sessionId, tool.input?.file_path]);

  return { isReviewable, reviewState, onAccept, onReject };
}
