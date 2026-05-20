/**
 * Machine fetching and decryption logic, extracted from sync.ts.
 * Follows the same context-object pattern as syncArtifacts.ts.
 */

import { Encryption } from "./encryption/encryption";
import { AuthCredentials } from "@/auth/tokenStorage";
import { storage } from "./storage";
import { log } from "@/log";
import { getServerUrl } from "./serverConfig";
import { Machine } from "./storageTypes";

export type MachineContext = {
  credentials: AuthCredentials;
  encryption: Encryption;
  machineDataKeys: Map<string, Uint8Array>;
};

type MachineItem = {
  id: string;
  metadata: string;
  metadataVersion: number;
  daemonState?: string | null;
  daemonStateVersion?: number;
  dataEncryptionKey?: string | null;
  seq: number;
  active: boolean;
  activeAt: number;
  createdAt: number;
  updatedAt: number;
};

export async function fetchMachinesAction(ctx: MachineContext): Promise<void> {
  const { credentials, encryption, machineDataKeys } = ctx;

  log.log("📊 Sync: Fetching machines...");
  const API_ENDPOINT = getServerUrl();

  const allMachines: MachineItem[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(`${API_ENDPOINT}/v1/machines?${params}`, {
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      log.error(`Failed to fetch machines: ${response.status}`);
      return;
    }

    const data = (await response.json()) as {
      machines: MachineItem[];
      nextCursor: string | null;
    };
    allMachines.push(...data.machines);
    cursor = data.nextCursor ?? undefined;
  } while (cursor);

  log.log(`📊 Sync: Fetched ${allMachines.length} machines from server`);

  // First, collect and decrypt encryption keys for all machines
  const machineKeysMap = new Map<string, Uint8Array | null>();
  for (const machine of allMachines) {
    if (machine.dataEncryptionKey) {
      const decryptedKey = await encryption.decryptEncryptionKey(
        machine.dataEncryptionKey,
      );
      if (!decryptedKey) {
        log.error(
          `Failed to decrypt data encryption key for machine ${machine.id}`,
        );
        continue;
      }
      machineKeysMap.set(machine.id, decryptedKey);
      machineDataKeys.set(machine.id, decryptedKey);
    } else {
      machineKeysMap.set(machine.id, null);
    }
  }

  // Initialize machine encryptions
  await encryption.initializeMachines(machineKeysMap);

  // Process all machines first, then update state once
  const decryptedMachines: Machine[] = [];

  for (const machine of allMachines) {
    const machineEncryption = encryption.getMachineEncryption(machine.id);
    if (!machineEncryption) {
      log.error(
        `Machine encryption not found for ${machine.id} - this should never happen`,
      );
      continue;
    }

    try {
      const metadata = machine.metadata
        ? await machineEncryption.decryptMetadata(
            machine.metadataVersion,
            machine.metadata,
          )
        : null;

      const daemonState = machine.daemonState
        ? await machineEncryption.decryptDaemonState(
            machine.daemonStateVersion || 0,
            machine.daemonState,
          )
        : null;

      decryptedMachines.push({
        id: machine.id,
        seq: machine.seq,
        createdAt: machine.createdAt,
        updatedAt: machine.updatedAt,
        active: machine.active,
        activeAt: machine.activeAt,
        rpcReady: false,
        metadata,
        metadataVersion: machine.metadataVersion,
        daemonState,
        daemonStateVersion: machine.daemonStateVersion || 0,
      });
    } catch (error) {
      log.error(`Failed to decrypt machine ${machine.id}:`, error);
      decryptedMachines.push({
        id: machine.id,
        seq: machine.seq,
        createdAt: machine.createdAt,
        updatedAt: machine.updatedAt,
        active: machine.active,
        activeAt: machine.activeAt,
        rpcReady: false,
        metadata: null,
        metadataVersion: machine.metadataVersion,
        daemonState: null,
        daemonStateVersion: 0,
      });
    }
  }

  // Replace entire machine state with fetched machines
  storage.getState().applyMachines(decryptedMachines, true);
  log.log(
    `🖥️ fetchMachines completed - processed ${decryptedMachines.length} machines`,
  );
}
