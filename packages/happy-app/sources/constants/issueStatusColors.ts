import { t } from "@/text";
import type { IssueSessionStatus } from "@/sync/issueSessionTypes";

export const ISSUE_STATUS_COLORS: Record<
    IssueSessionStatus,
    { bg: string; text: string }
> = {
    processing: { bg: "rgba(0, 122, 255, 0.12)", text: "#007AFF" },
    completed: { bg: "rgba(52, 199, 89, 0.12)", text: "#34C759" },
    failed: { bg: "rgba(255, 59, 48, 0.12)", text: "#FF3B30" },
    cancelled: { bg: "rgba(142, 142, 147, 0.12)", text: "#8E8E93" },
};

export const ISSUE_STATUS_LABELS: Record<IssueSessionStatus, () => string> = {
    processing: () => t("issues.statusProcessing"),
    completed: () => t("issues.statusCompleted"),
    failed: () => t("issues.statusFailed"),
    cancelled: () => t("issues.statusCancelled"),
};
