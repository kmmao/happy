import { describe, expect, it } from "vitest";
import { recoverSessionMetadataAfterDecrypt } from "./sessionMetadataRecovery";

describe("recoverSessionMetadataAfterDecrypt", () => {
  it("preserves the last known-good metadata when a newer blob fails to decrypt", () => {
    const existingMetadata = {
      path: "/repo",
      host: "home-mac",
      machineId: "machine-1",
      flavor: "codex",
      progress: {
        lists: [
          {
            id: "list-1",
            todos: [
              {
                content: "Keep historical progress visible",
                status: "completed" as const,
              },
            ],
            startedAt: 1,
            updatedAt: 2,
          },
        ],
        currentListId: "list-1",
        todos: [
          {
            content: "Keep historical progress visible",
            status: "completed" as const,
          },
        ],
        updatedAt: 2,
      },
    };

    const result = recoverSessionMetadataAfterDecrypt({
      existingSession: {
        metadata: existingMetadata,
        metadataVersion: 4,
      } as any,
      decryptedMetadata: null,
      incomingMetadataVersion: 5,
    });

    expect(result).toEqual({
      metadata: existingMetadata,
      metadataVersion: 4,
      metadataDecryptFailed: true,
    });
  });

  it("uses the decrypted metadata when decryption succeeds", () => {
    const decryptedMetadata = {
      path: "/repo",
      host: "home-mac",
      machineId: "machine-1",
      flavor: "codex",
    };

    const result = recoverSessionMetadataAfterDecrypt({
      existingSession: {
        metadata: {
          path: "/old",
          host: "old-host",
        },
        metadataVersion: 1,
      } as any,
      decryptedMetadata,
      incomingMetadataVersion: 2,
    });

    expect(result).toEqual({
      metadata: decryptedMetadata,
      metadataVersion: 2,
      metadataDecryptFailed: false,
    });
  });

  it("returns null metadata when decrypt fails and there is no prior value to preserve", () => {
    const result = recoverSessionMetadataAfterDecrypt({
      existingSession: undefined,
      decryptedMetadata: null,
      incomingMetadataVersion: 3,
    });

    expect(result).toEqual({
      metadata: null,
      metadataVersion: 3,
      metadataDecryptFailed: true,
    });
  });
});
