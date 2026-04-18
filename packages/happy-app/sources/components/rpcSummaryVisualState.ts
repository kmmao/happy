import type { SessionRpcVisualState } from "@/utils/sessionRpcVisualState";

type RpcSummaryThemeColors = {
  accentOrange: string;
  success: string;
  divider: string;
  surfacePressed: string;
  text: string;
  textSecondary: string;
  shadow: {
    color: string;
  };
};

type RpcStateTranslationKey =
  | "agentInput.rpcState.disconnected"
  | "agentInput.rpcState.reconnecting"
  | "agentInput.rpcState.rpcPending"
  | "agentInput.rpcState.rpcReady";

export type RpcSummaryVisualState = {
  borderColor: string;
  backgroundColor: string;
  glowColor: string;
  pillBackgroundColor: string;
  pillTextColor: string;
  pillDotColor: string;
  summaryTextColor: string;
};

export function getRpcSummaryVisualState(
  rpcState: SessionRpcVisualState | null | undefined,
  colors: RpcSummaryThemeColors,
): RpcSummaryVisualState {
  switch (rpcState) {
    case "reconnecting":
    case "rpcPending":
      return {
        borderColor: `${colors.accentOrange}55`,
        backgroundColor: `${colors.accentOrange}12`,
        glowColor: colors.accentOrange,
        pillBackgroundColor: `${colors.accentOrange}18`,
        pillTextColor: colors.accentOrange,
        pillDotColor: colors.accentOrange,
        summaryTextColor: colors.text,
      };
    case "rpcReady":
      return {
        borderColor: `${colors.success}45`,
        backgroundColor: `${colors.success}10`,
        glowColor: colors.success,
        pillBackgroundColor: `${colors.success}18`,
        pillTextColor: colors.success,
        pillDotColor: colors.success,
        summaryTextColor: colors.text,
      };
    case "disconnected":
      return {
        borderColor: colors.divider,
        backgroundColor: colors.surfacePressed,
        glowColor: colors.textSecondary,
        pillBackgroundColor: `${colors.textSecondary}14`,
        pillTextColor: colors.textSecondary,
        pillDotColor: colors.textSecondary,
        summaryTextColor: colors.textSecondary,
      };
    default:
      return {
        borderColor: "transparent",
        backgroundColor: `${colors.surfacePressed}CC`,
        glowColor: colors.shadow.color,
        pillBackgroundColor: `${colors.surfacePressed}CC`,
        pillTextColor: colors.textSecondary,
        pillDotColor: colors.textSecondary,
        summaryTextColor: colors.textSecondary,
      };
  }
}

export function getRpcSummaryStatusLabel(params: {
  rpcState?: SessionRpcVisualState | null;
  translate: (key: RpcStateTranslationKey) => string;
}): string | null {
  switch (params.rpcState) {
    case "disconnected":
      return params.translate("agentInput.rpcState.disconnected");
    case "reconnecting":
      return params.translate("agentInput.rpcState.reconnecting");
    case "rpcPending":
      return params.translate("agentInput.rpcState.rpcPending");
    case "rpcReady":
      return params.translate("agentInput.rpcState.rpcReady");
    default:
      return null;
  }
}

export function buildRpcSummaryText(params: {
  permissionLabel?: string | null;
  modelLabel?: string | null;
  reasoningLabels?: readonly (string | null | undefined)[] | null;
}): string | null {
  const labels = [
    params.permissionLabel,
    params.modelLabel,
    ...(params.reasoningLabels ?? []),
  ].filter((label): label is string => Boolean(label && label.trim()));

  if (labels.length === 0) {
    return null;
  }

  return labels.join(" · ");
}
