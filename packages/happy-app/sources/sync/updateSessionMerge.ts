import type { Session, Metadata, SessionPreferences } from "./storageTypes";
import { overlayPendingSessionPreferences } from "./sessionPreferencesState";
import { recoverSessionMetadataAfterDecrypt } from "./sessionMetadataRecovery";

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
  pendingPreferences?: SessionPreferences | null;
};

type MergeUpdatedSessionResult = {
  updatedSession: Session;
  metadataDecryptFailed: boolean;
};

export function mergeUpdatedSession(
  input: MergeUpdatedSessionInput,
): MergeUpdatedSessionResult {
  const metadataRecovery = input.metadataUpdate
    ? recoverSessionMetadataAfterDecrypt({
        existingSession: input.session,
        decryptedMetadata: input.metadata,
        incomingMetadataVersion: input.metadataUpdate.version,
      })
    : {
        metadata: input.metadata,
        metadataVersion: input.session.metadataVersion,
        metadataDecryptFailed: false,
      };

  const updatedSession: Session = {
    ...input.session,
    agentState: input.agentState,
    agentStateVersion: input.agentStateVersion,
    metadata: metadataRecovery.metadata,
    metadataVersion: metadataRecovery.metadataVersion,
    preferencesVersion: input.preferencesUpdate
      ? input.preferencesUpdate.version
      : input.session.preferencesVersion,
    ...(input.preferences
      ? {
          permissionMode: input.preferences.permissionMode,
          modelMode: input.preferences.modelMode,
          pinnedModelId: input.preferences.pinnedModelId,
          customModels: input.preferences.customModels,
          modelMappings: input.preferences.modelMappings,
          profileId: input.preferences.profileId,
          profileName: input.preferences.profileName,
          thinkingMode: input.preferences.thinkingMode,
          thinkingBudget: input.preferences.thinkingBudget,
          effortLevel: input.preferences.effortLevel,
          maxBudgetUsd: input.preferences.maxBudgetUsd,
          taskBudgetTokens: input.preferences.taskBudgetTokens,
        }
      : {}),
    updatedAt: input.updatedAt,
    seq: input.seq,
  };

  return {
    updatedSession: overlayPendingSessionPreferences(
      updatedSession,
      input.pendingPreferences,
    ),
    metadataDecryptFailed: metadataRecovery.metadataDecryptFailed,
  };
}
