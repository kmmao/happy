/**
 * HTTP API client for happy-agent.
 *
 * Provides all HTTP-based operations: session CRUD, message fetching,
 * and v3 batch message API. Migrated from src/api.ts with v3 additions.
 */

import axios, { AxiosError } from "axios";
import type { SessionMessage as WireSessionMessage } from "@kmmao/happy-wire";
import type { Config } from "../config";
import type { Credentials } from "../credentials";
import {
  decodeBase64,
  encodeBase64,
  decryptBoxBundle,
  decryptWithDataKey,
  decryptLegacy,
  encryptWithDataKey,
  encrypt,
  libsodiumEncryptForPublicKey,
  getRandomBytes,
} from "../encryption";
import type {
  EncryptionVariant,
  SessionEncryption,
  RawSession,
  DecryptedSession,
  Machine,
  MachineMetadata,
} from "./types";

// Re-export types that external code needs
export type { EncryptionVariant, SessionEncryption, RawSession, DecryptedSession } from "./types";

export type RawMessage = WireSessionMessage;

export type DecryptedMessage = {
  id: string;
  seq: number;
  content: unknown;
  localId: string | null;
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// v3 types
// ---------------------------------------------------------------------------

type V3SessionMessage = {
  id: string;
  seq: number;
  content: { t: "encrypted"; c: string };
  localId: string | null;
  createdAt: number;
  updatedAt: number;
};

type V3GetMessagesResponse = {
  messages: V3SessionMessage[];
  hasMore: boolean;
};

type V3PostMessagesResponse = {
  messages: Array<{
    id: string;
    seq: number;
    localId: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
};

// ---------------------------------------------------------------------------
// Session encryption key resolution
// ---------------------------------------------------------------------------

export function resolveSessionEncryption(
  session: RawSession,
  creds: Credentials,
): SessionEncryption {
  if (session.dataEncryptionKey) {
    const encrypted = decodeBase64(session.dataEncryptionKey);
    const bundle = encrypted.slice(1);
    const sessionKey = decryptBoxBundle(bundle, creds.contentKeyPair.secretKey);
    if (!sessionKey) {
      throw new Error(
        `Failed to decrypt session key for session ${session.id}`,
      );
    }
    return { key: sessionKey, variant: "dataKey" };
  }
  return { key: creds.secret, variant: "legacy" };
}

// ---------------------------------------------------------------------------
// Decrypt helpers
// ---------------------------------------------------------------------------

function decryptField(
  encrypted: string | null,
  encryption: SessionEncryption,
): unknown | null {
  if (!encrypted) return null;
  const data = decodeBase64(encrypted);
  if (encryption.variant === "dataKey") {
    return decryptWithDataKey(data, encryption.key);
  }
  return decryptLegacy(data, encryption.key);
}

function decryptSession(raw: RawSession, creds: Credentials): DecryptedSession {
  const encryption = resolveSessionEncryption(raw, creds);
  return {
    id: raw.id,
    seq: raw.seq,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    active: raw.active,
    activeAt: raw.activeAt,
    metadata: decryptField(raw.metadata, encryption),
    metadataVersion: raw.metadataVersion,
    agentState: decryptField(raw.agentState, encryption),
    dataEncryptionKey: raw.dataEncryptionKey,
    encryption,
  };
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

function handleApiError(err: unknown, context: string): never {
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    if (status === 401) {
      throw new Error(
        "Authentication expired. Run `happy-agent auth login` to re-authenticate.",
      );
    }
    if (status === 403) {
      throw new Error(`Forbidden: ${context}. Check your account permissions.`);
    }
    if (status === 404) {
      throw new Error(`Not found: ${context}`);
    }
    if (status && status >= 400 && status < 500) {
      const detail = err.response?.data
        ? `: ${JSON.stringify(err.response.data)}`
        : "";
      throw new Error(`Request failed (${status})${detail}`);
    }
    if (status && status >= 500) {
      throw new Error(`Server error (${status}): ${context}`);
    }
    throw new Error(`Request failed: ${err.message}`);
  }
  throw err;
}

function authHeaders(creds: Credentials): Record<string, string> {
  return { Authorization: `Bearer ${creds.token}` };
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export async function listSessions(
  config: Config,
  creds: Credentials,
): Promise<DecryptedSession[]> {
  const allSessions: RawSession[] = [];
  let cursor: string | undefined;

  while (true) {
    const params: Record<string, string> = { limit: "100" };
    if (cursor) params.cursor = cursor;

    let data: { sessions: RawSession[]; nextCursor?: string };
    try {
      const resp = await axios.get(`${config.serverUrl}/v2/sessions`, {
        headers: authHeaders(creds),
        params,
      });
      data = resp.data as { sessions: RawSession[]; nextCursor?: string };
    } catch (err) {
      handleApiError(err, "listing sessions");
    }

    allSessions.push(...data.sessions);
    if (!data.nextCursor || data.sessions.length === 0) break;
    cursor = data.nextCursor;
  }

  return allSessions.map((raw) => decryptSession(raw, creds));
}

export async function listActiveSessions(
  config: Config,
  creds: Credentials,
): Promise<DecryptedSession[]> {
  let data: { sessions: RawSession[] };
  try {
    const resp = await axios.get(`${config.serverUrl}/v2/sessions/active`, {
      headers: authHeaders(creds),
    });
    data = resp.data as { sessions: RawSession[] };
  } catch (err) {
    handleApiError(err, "listing active sessions");
  }
  return data.sessions.map((raw) => decryptSession(raw, creds));
}

export async function createSession(
  config: Config,
  creds: Credentials,
  opts: { tag: string; metadata: unknown },
): Promise<DecryptedSession & { sessionKey: Uint8Array }> {
  const sessionKey = getRandomBytes(32);
  const encryptedKey = libsodiumEncryptForPublicKey(
    sessionKey,
    creds.contentKeyPair.publicKey,
  );
  const withVersion = new Uint8Array(1 + encryptedKey.length);
  withVersion[0] = 0x00;
  withVersion.set(encryptedKey, 1);
  const dataEncryptionKeyBase64 = encodeBase64(withVersion);

  const encryptedMetadata = encryptWithDataKey(opts.metadata, sessionKey);
  const metadataBase64 = encodeBase64(encryptedMetadata);

  let data: { session: RawSession };
  try {
    const resp = await axios.post(
      `${config.serverUrl}/v1/sessions`,
      {
        tag: opts.tag,
        metadata: metadataBase64,
        dataEncryptionKey: dataEncryptionKeyBase64,
      },
      { headers: authHeaders(creds) },
    );
    data = resp.data as { session: RawSession };
  } catch (err) {
    handleApiError(err, "creating session");
  }

  const decrypted = decryptSession(data.session, creds);
  return { ...decrypted, sessionKey: decrypted.encryption.key };
}

export async function deleteSession(
  config: Config,
  creds: Credentials,
  sessionId: string,
): Promise<void> {
  try {
    await axios.delete(
      `${config.serverUrl}/v1/sessions/${encodeURIComponent(sessionId)}`,
      { headers: authHeaders(creds) },
    );
  } catch (err) {
    handleApiError(err, `deleting session ${sessionId}`);
  }
}

// ---------------------------------------------------------------------------
// Messages — v1 (legacy)
// ---------------------------------------------------------------------------

export async function getSessionMessages(
  config: Config,
  creds: Credentials,
  sessionId: string,
  encryption: SessionEncryption,
): Promise<DecryptedMessage[]> {
  let data: { messages: RawMessage[] };
  try {
    const resp = await axios.get(
      `${config.serverUrl}/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      { headers: authHeaders(creds) },
    );
    data = resp.data as { messages: RawMessage[] };
  } catch (err) {
    handleApiError(err, `session ${sessionId} messages`);
  }

  return data.messages.map((msg) => ({
    id: msg.id,
    seq: msg.seq,
    content: decryptField(msg.content.c, encryption),
    localId: msg.localId ?? null,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// Messages — v3 batch API
// ---------------------------------------------------------------------------

/**
 * Fetch messages after a given seq using v3 API.
 * Returns decrypted messages and whether more pages are available.
 */
export async function fetchMessagesAfterSeq(
  config: Config,
  creds: Credentials,
  sessionId: string,
  encryption: SessionEncryption,
  afterSeq: number,
  limit = 100,
): Promise<{ messages: DecryptedMessage[]; hasMore: boolean }> {
  let data: V3GetMessagesResponse;
  try {
    const resp = await axios.get(
      `${config.serverUrl}/v3/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        params: { after_seq: afterSeq, limit },
        headers: authHeaders(creds),
        timeout: 60_000,
      },
    );
    data = resp.data as V3GetMessagesResponse;
  } catch (err) {
    handleApiError(err, `fetching v3 messages for session ${sessionId}`);
  }

  const messages = data.messages
    .map((msg) => {
      const content = decryptField(msg.content.c, encryption);
      if (content === null) return null;
      return {
        id: msg.id,
        seq: msg.seq,
        content,
        localId: msg.localId ?? null,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  return { messages, hasMore: data.hasMore };
}

/**
 * Send a batch of encrypted messages using v3 API.
 */
export async function sendMessagesBatch(
  config: Config,
  creds: Credentials,
  sessionId: string,
  encryption: SessionEncryption,
  contents: unknown[],
): Promise<V3PostMessagesResponse> {
  const messages = contents.map((content) => ({
    content: encodeBase64(
      encrypt(encryption.key, encryption.variant, content),
    ),
  }));

  let data: V3PostMessagesResponse;
  try {
    const resp = await axios.post(
      `${config.serverUrl}/v3/sessions/${encodeURIComponent(sessionId)}/messages`,
      { messages },
      { headers: authHeaders(creds), timeout: 60_000 },
    );
    data = resp.data as V3PostMessagesResponse;
  } catch (err) {
    handleApiError(err, `sending v3 messages to session ${sessionId}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Machine API
// ---------------------------------------------------------------------------

type RawMachine = {
  id: string;
  metadata: string;
  metadataVersion: number;
  daemonState: string | null;
  daemonStateVersion: number;
  dataEncryptionKey: string | null;
};

/**
 * Get or create a machine identity on the server.
 * Returns the machine with decrypted metadata.
 */
export async function getOrCreateMachine(
  config: Config,
  creds: Credentials,
  metadata: MachineMetadata,
): Promise<Machine> {
  const sessionKey = getRandomBytes(32);
  const encryptedKey = libsodiumEncryptForPublicKey(
    sessionKey,
    creds.contentKeyPair.publicKey,
  );
  const withVersion = new Uint8Array(1 + encryptedKey.length);
  withVersion[0] = 0x00;
  withVersion.set(encryptedKey, 1);

  const encryptedMetadata = encryptWithDataKey(metadata, sessionKey);

  let data: { machine: RawMachine };
  try {
    const resp = await axios.post(
      `${config.serverUrl}/v2/machines`,
      {
        metadata: encodeBase64(encryptedMetadata),
        dataEncryptionKey: encodeBase64(withVersion),
      },
      { headers: authHeaders(creds) },
    );
    data = resp.data as { machine: RawMachine };
  } catch (err) {
    handleApiError(err, "registering machine");
  }

  const raw = data.machine;
  let encKey: Uint8Array;
  let encVariant: EncryptionVariant;
  if (raw.dataEncryptionKey) {
    const encrypted = decodeBase64(raw.dataEncryptionKey);
    const bundle = encrypted.slice(1);
    const key = decryptBoxBundle(bundle, creds.contentKeyPair.secretKey);
    if (!key) throw new Error("Failed to decrypt machine encryption key");
    encKey = key;
    encVariant = "dataKey";
  } else {
    encKey = creds.secret;
    encVariant = "legacy";
  }

  return {
    id: raw.id,
    encryptionKey: encKey,
    encryptionVariant: encVariant,
    metadata: (decryptField(raw.metadata, { key: encKey, variant: encVariant }) ?? metadata) as MachineMetadata,
    metadataVersion: raw.metadataVersion,
    daemonState: raw.daemonState
      ? (decryptField(raw.daemonState, { key: encKey, variant: encVariant }) as any)
      : null,
    daemonStateVersion: raw.daemonStateVersion,
  };
}

/**
 * List all machines for the current account.
 */
export async function listMachines(
  config: Config,
  creds: Credentials,
): Promise<RawMachine[]> {
  let data: { machines: RawMachine[] };
  try {
    const resp = await axios.get(`${config.serverUrl}/v2/machines`, {
      headers: authHeaders(creds),
    });
    data = resp.data as { machines: RawMachine[] };
  } catch (err) {
    handleApiError(err, "listing machines");
  }
  return data.machines;
}
