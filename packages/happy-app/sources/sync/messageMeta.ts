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
    | "modelMappings"
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
  // Apply model mappings: e.g., "opus" → "MiniMax-M2.5" if profile has modelMappings
  const rawModel = modelMode !== "default" ? modelMode : null;
  const model =
    rawModel && session.modelMappings?.[rawModel]
      ? session.modelMappings[rawModel]
      : rawModel;

  // Resolve thinking configuration
  // Default to "adaptive" when not set, matching native Claude Code behavior
  const thinkingMode = session.thinkingMode;
  const effectiveThinkingMode = thinkingMode ?? "adaptive";
  const thinking =
    effectiveThinkingMode !== "disabled"
      ? {
          type: effectiveThinkingMode as "adaptive" | "enabled",
          ...(effectiveThinkingMode === "enabled" && session.thinkingBudget
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
