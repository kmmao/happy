/**
 * Re-export bridge — all API functions now live in api/httpClient.ts.
 * This file preserves backward compatibility for existing imports.
 */

export {
  listSessions,
  listActiveSessions,
  createSession,
  deleteSession,
  getSessionMessages,
  resolveSessionEncryption,
  fetchMessagesAfterSeq,
  sendMessagesBatch,
  getOrCreateMachine,
  listMachines,
} from "./api/httpClient";

export type {
  EncryptionVariant,
  SessionEncryption,
  RawSession,
  DecryptedSession,
  RawMessage,
  DecryptedMessage,
} from "./api/httpClient";
