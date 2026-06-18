import type { Session, SessionPreferences } from "./storageTypes";

type SessionPreferenceSource = Pick<
  Session,
  | "permissionMode"
  | "modelMode"
  | "pinnedModelId"
  | "customModels"
  | "modelMappings"
  | "profileId"
  | "profileName"
  | "thinkingMode"
  | "thinkingBudget"
  | "effortLevel"
  | "maxBudgetUsd"
  | "taskBudgetTokens"
  | "starred"
  | "autoCompact"
>;

export function normalizeSessionPreferencesSnapshot(
  input: Partial<SessionPreferences> | null | undefined,
): SessionPreferences {
  return {
    permissionMode: input?.permissionMode ?? null,
    modelMode: input?.modelMode ?? null,
    pinnedModelId: input?.pinnedModelId ?? null,
    customModels: input?.customModels ?? null,
    modelMappings: input?.modelMappings ?? null,
    profileId: input?.profileId ?? null,
    profileName: input?.profileName ?? null,
    thinkingMode: input?.thinkingMode ?? null,
    thinkingBudget:
      input?.thinkingBudget === undefined ? null : input.thinkingBudget,
    effortLevel: input?.effortLevel ?? null,
    maxBudgetUsd: input?.maxBudgetUsd === undefined ? null : input.maxBudgetUsd,
    taskBudgetTokens:
      input?.taskBudgetTokens === undefined ? null : input.taskBudgetTokens,
    starred: input?.starred ?? null,
  };
}

export function buildSessionPreferencesSnapshot(
  session: SessionPreferenceSource,
): SessionPreferences {
  return normalizeSessionPreferencesSnapshot(session);
}

export function areSessionPreferencesEqual(
  left: Partial<SessionPreferences> | null | undefined,
  right: Partial<SessionPreferences> | null | undefined,
): boolean {
  return (
    JSON.stringify(normalizeSessionPreferencesSnapshot(left)) ===
    JSON.stringify(normalizeSessionPreferencesSnapshot(right))
  );
}

export function overlayPendingSessionPreferences(
  session: Session,
  pending: Partial<SessionPreferences> | null | undefined,
): Session {
  if (!pending) {
    return session;
  }

  const normalized = normalizeSessionPreferencesSnapshot(pending);
  return {
    ...session,
    permissionMode: normalized.permissionMode,
    modelMode: normalized.modelMode,
    pinnedModelId: normalized.pinnedModelId,
    customModels: normalized.customModels,
    modelMappings: normalized.modelMappings,
    profileId: normalized.profileId,
    profileName: normalized.profileName,
    thinkingMode: normalized.thinkingMode,
    thinkingBudget: normalized.thinkingBudget,
    effortLevel: normalized.effortLevel,
    maxBudgetUsd: normalized.maxBudgetUsd,
    taskBudgetTokens: normalized.taskBudgetTokens,
    starred: normalized.starred,
  };
}
