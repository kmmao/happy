import type { MessageMeta, PermissionMode } from "@/api/types";
import { hashObject } from "@/utils/deterministicJson";

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
    reasoningEffort: mode.reasoningEffort,
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

  let model = current.model;
  if (meta && Object.prototype.hasOwnProperty.call(meta, "model")) {
    model = meta.model || undefined;
  }

  let reasoningEffort = current.reasoningEffort;
  if (meta && Object.prototype.hasOwnProperty.call(meta, "effort")) {
    reasoningEffort = meta.effort ?? undefined;
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
