import type { MessageMeta, PermissionMode } from "@/api/types";
import { LOCKED_CODEX_MODEL } from "@/codex-shared/configResolution";
import { hashObject } from "@/utils/deterministicJson";

function normalizeCodexReasoningEffort(
  effort: NonNullable<MessageMeta["effort"]> | undefined,
): NonNullable<MessageMeta["effort"]> | undefined {
  if (effort === "max") {
    return "xhigh";
  }

  return effort;
}

function normalizeCodexModel(model: string | null | undefined): string | undefined {
  if (!model) {
    return undefined;
  }

  return LOCKED_CODEX_MODEL;
}

export interface CodexMessageModeState {
  permissionMode?: PermissionMode;
  model?: string;
  reasoningEffort?: NonNullable<MessageMeta["effort"]>;
}

export interface CodexMessageMode {
  permissionMode: PermissionMode;
  model?: string;
  reasoningEffort?: NonNullable<MessageMeta["effort"]>;
}

export function hashCodexMode(mode: CodexMessageMode): string {
  return hashObject({
    permissionMode: mode.permissionMode,
    model: mode.model,
    reasoningEffort: normalizeCodexReasoningEffort(mode.reasoningEffort),
  });
}

export function resolveCodexMessageMode(params: {
  current: CodexMessageModeState;
  meta?: MessageMeta | null;
}): {
  mode: CodexMessageMode;
  next: CodexMessageModeState;
} {
  const { current, meta } = params;

  let permissionMode = current.permissionMode;
  if (meta?.permissionMode) {
    permissionMode = meta.permissionMode as PermissionMode;
  }

  let model = normalizeCodexModel(current.model);
  if (meta && Object.prototype.hasOwnProperty.call(meta, "model")) {
    model = normalizeCodexModel(meta.model ?? undefined);
  }

  let reasoningEffort = normalizeCodexReasoningEffort(current.reasoningEffort);
  if (meta && Object.prototype.hasOwnProperty.call(meta, "effort")) {
    reasoningEffort = normalizeCodexReasoningEffort(meta.effort ?? undefined);
  }

  return {
    mode: {
      permissionMode: permissionMode ?? "default",
      model,
      reasoningEffort,
    },
    next: {
      permissionMode,
      model,
      reasoningEffort,
    },
  };
}
