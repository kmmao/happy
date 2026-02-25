import type { Session } from "./storageTypes";
import type { PermissionModeKey } from "@/components/PermissionModeSelector";

function isSandboxEnabled(
  metadata: Session["metadata"] | null | undefined,
): boolean {
  const sandbox = metadata?.sandbox;
  return (
    !!sandbox &&
    typeof sandbox === "object" &&
    (sandbox as { enabled?: unknown }).enabled === true
  );
}

export interface ResolvedMessageMeta {
  permissionMode: PermissionModeKey;
  model: string | null;
  thinking: {
    type: "adaptive" | "enabled";
    budgetTokens?: number;
  } | null;
  effort: "low" | "medium" | "high" | "max" | null;
  maxBudgetUsd: number | null;
}

export function resolveMessageModeMeta(
  session: Pick<
    Session,
    | "permissionMode"
    | "modelMode"
    | "metadata"
    | "thinkingMode"
    | "thinkingBudget"
    | "effortLevel"
    | "maxBudgetUsd"
  >,
): ResolvedMessageMeta {
  const sandboxEnabled = isSandboxEnabled(session.metadata);
  const permissionMode: PermissionModeKey =
    session.permissionMode && session.permissionMode !== "default"
      ? session.permissionMode
      : sandboxEnabled
        ? "bypassPermissions"
        : "default";

  const modelMode = session.modelMode || "default";
  const model = modelMode !== "default" ? modelMode : null;

  // Resolve thinking configuration
  const thinkingMode = session.thinkingMode;
  const thinking =
    thinkingMode && thinkingMode !== "disabled"
      ? {
          type: thinkingMode as "adaptive" | "enabled",
          ...(thinkingMode === "enabled" && session.thinkingBudget
            ? { budgetTokens: session.thinkingBudget }
            : {}),
        }
      : null;

  // Resolve effort level
  const effortLevel = session.effortLevel;
  const effort = effortLevel
    ? (effortLevel as "low" | "medium" | "high" | "max")
    : null;

  // Resolve max budget
  const maxBudgetUsd = session.maxBudgetUsd ?? null;

  return {
    permissionMode,
    model,
    thinking,
    effort,
    maxBudgetUsd,
  };
}
