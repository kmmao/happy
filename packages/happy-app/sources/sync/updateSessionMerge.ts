import type { Session, Metadata, SessionPreferences } from "./storageTypes";

type MetadataUpdate = {
  version: number;
} | null | undefined;

type PreferencesUpdate = {
  version: number;
} | null | undefined;

type MergeUpdatedSessionInput = {
  session: Session;
  seq: number;
  updatedAt: number;
  agentState: Session["agentState"];
  agentStateVersion: number;
  metadata: Metadata | null;
  metadataUpdate?: MetadataUpdate;
  preferences: SessionPreferences | null;
  preferencesUpdate?: PreferencesUpdate;
};

type MergeUpdatedSessionResult = {
  updatedSession: Session;
  metadataDecryptFailed: boolean;
};

export function mergeUpdatedSession(
  input: MergeUpdatedSessionInput,
): MergeUpdatedSessionResult {
  const metadataDecryptFailed = Boolean(
    input.metadataUpdate && !input.metadata,
  );

  const updatedSession: Session = {
    ...input.session,
    agentState: input.agentState,
    agentStateVersion: input.agentStateVersion,
    metadata: metadataDecryptFailed ? input.session.metadata : input.metadata,
    metadataVersion: metadataDecryptFailed
      ? input.session.metadataVersion
      : input.metadataUpdate
        ? input.metadataUpdate.version
        : input.session.metadataVersion,
    preferencesVersion: input.preferencesUpdate
      ? input.preferencesUpdate.version
      : input.session.preferencesVersion,
    ...(input.preferences
      ? {
          permissionMode: input.preferences.permissionMode,
          modelMode: input.preferences.modelMode,
          customModels: input.preferences.customModels,
          modelMappings: input.preferences.modelMappings,
          profileId: input.preferences.profileId,
          profileName: input.preferences.profileName,
          thinkingMode: input.preferences.thinkingMode,
          thinkingBudget: input.preferences.thinkingBudget,
          effortLevel: input.preferences.effortLevel,
          maxBudgetUsd: input.preferences.maxBudgetUsd,
        }
      : {}),
    updatedAt: input.updatedAt,
    seq: input.seq,
  };

  return {
    updatedSession,
    metadataDecryptFailed,
  };
}
