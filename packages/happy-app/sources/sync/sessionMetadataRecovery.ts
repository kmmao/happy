import type { Metadata, Session } from "./storageTypes";

type ExistingSessionMetadata =
  | Pick<Session, "metadata" | "metadataVersion">
  | null
  | undefined;

type RecoverSessionMetadataInput = {
  existingSession?: ExistingSessionMetadata;
  decryptedMetadata: Metadata | null;
  incomingMetadataVersion: number;
};

type RecoverSessionMetadataResult = {
  metadata: Metadata | null;
  metadataVersion: number;
  metadataDecryptFailed: boolean;
};

/**
 * Decrypt failure is not an authoritative "clear metadata" signal. It usually
 * means a transient key/version/schema mismatch, so preserve the last known-good
 * metadata when we have one.
 */
export function recoverSessionMetadataAfterDecrypt(
  input: RecoverSessionMetadataInput,
): RecoverSessionMetadataResult {
  if (input.decryptedMetadata) {
    return {
      metadata: input.decryptedMetadata,
      metadataVersion: input.incomingMetadataVersion,
      metadataDecryptFailed: false,
    };
  }

  if (input.existingSession?.metadata) {
    return {
      metadata: input.existingSession.metadata,
      metadataVersion: input.existingSession.metadataVersion,
      metadataDecryptFailed: true,
    };
  }

  return {
    metadata: null,
    metadataVersion: input.incomingMetadataVersion,
    metadataDecryptFailed: true,
  };
}
