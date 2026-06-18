import type { Session } from "./storageTypes";
import type { Settings } from "./settings";
import { getAgentDefaultOverride } from "./agentDefaults";
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
  effort: "low" | "medium" | "high" | "max" | "xhigh" | null;
  maxBudgetUsd: number | null;
  taskBudget: { total: number } | null;
}

export function resolveMessageModeMeta(
  session: Pick<
    Session,
    | "permissionMode"
    | "modelMode"
    | "pinnedModelId"
    | "modelMappings"
    | "metadata"
    | "thinkingMode"
    | "thinkingBudget"
    | "effortLevel"
    | "maxBudgetUsd"
    | "taskBudgetTokens"
  >,
  settings?: Pick<Settings, "agentDefaultOverrides">,
): ResolvedMessageMeta {
  // Per-agent overrides users picked in the Agent Defaults settings screen.
  // Always lower priority than an explicit session-level value; only kicks
  // in when the session field is unset / `'default'`.
  const agentOverrides = getAgentDefaultOverride(
    settings?.agentDefaultOverrides,
    session.metadata?.flavor,
  );

  const sandboxEnabled = isSandboxEnabled(session.metadata);
  // Priority: session override → settings agentDefault → sandbox auto-bypass → 'default'.
  let permissionMode: PermissionModeKey;
  if (session.permissionMode && session.permissionMode !== "default") {
    permissionMode = session.permissionMode;
  } else if (agentOverrides.permissionMode) {
    permissionMode = agentOverrides.permissionMode as PermissionModeKey;
  } else if (sandboxEnabled) {
    permissionMode = "bypassPermissions";
  } else {
    permissionMode = "default";
  }

  // Priority: session.modelMode → settings agentDefault.modelMode → 'default'.
  // The 'default' case yields null → CLI uses its own DEFAULT_*_MODEL constant.
  const resolvedModelKey =
    session.modelMode && session.modelMode !== "default"
      ? session.modelMode
      : agentOverrides.modelMode && agentOverrides.modelMode !== "default"
        ? agentOverrides.modelMode
        : "default";
  // Pinned model wins over the resolved key so profile/model mapping changes
  // can't silently retarget an existing session after creation. When no pin,
  // fall back to the resolved key (which already considered overrides).
  const rawModel =
    session.pinnedModelId ??
    (resolvedModelKey !== "default" ? resolvedModelKey : null);
  const model =
    rawModel && session.pinnedModelId == null && session.modelMappings?.[rawModel]
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

  // Resolve effort level — session value first, then settings agentDefault.
  // null in both → CLI uses its own DEFAULT_*_EFFORT.
  const effortLevel = session.effortLevel ?? agentOverrides.effortLevel ?? null;
  const effort = effortLevel
    ? (effortLevel as "low" | "medium" | "high" | "max" | "xhigh")
    : null;

  // Resolve max budget
  const maxBudgetUsd = session.maxBudgetUsd ?? null;

  // Resolve task budget (token-based, alpha)
  const taskBudget = session.taskBudgetTokens
    ? { total: session.taskBudgetTokens }
    : null;

  return {
    permissionMode,
    model,
    thinking,
    effort,
    maxBudgetUsd,
    taskBudget,
  };
}
