import { decodeBase64 } from "@/encryption/base64";
import { RawRecord } from "../typesRaw";
import { ApiMessage } from "../apiTypes";
import {
  DecryptedMessage,
  Metadata,
  MetadataSchema,
  AgentState,
  AgentStateSchema,
  SessionPreferences,
  SessionPreferencesSchema,
} from "../storageTypes";
import { EncryptionCache } from "./encryptionCache";
import { Decryptor, Encryptor } from "./encryptor";
import { decryptValue, decryptValueSafe, encryptValue } from "./codec";

/**
 * Why a message could not be surfaced as decrypted content. The per-session
 * cipher knows which of these happened; collapsing them all to a `null` content
 * forced every caller to re-guess. Naming them keeps that knowledge at the seam.
 *
 * In practice `decrypt-failed` is the live case (an encryption-key mismatch
 * after a session reconnect). The wire only models encrypted message content,
 * so `not-encrypted` is defensive against malformed/legacy records, and
 * `missing` against an empty input slot.
 */
export type MessageDecryptFailureReason =
  | "decrypt-failed"
  | "not-encrypted"
  | "missing";

/**
 * Result of decrypting a single message: either the decrypted message, or a
 * typed reason it could not be produced.
 */
export type MessageDecryptOutcome =
  | { ok: true; message: DecryptedMessage }
  | {
      ok: false;
      reason: MessageDecryptFailureReason;
      seq: number | null;
      id: string | null;
    };

export class SessionEncryption {
  private sessionId: string;
  private encryptor: Encryptor & Decryptor;
  private cache: EncryptionCache;

  constructor(
    sessionId: string,
    encryptor: Encryptor & Decryptor,
    cache: EncryptionCache,
  ) {
    this.sessionId = sessionId;
    this.encryptor = encryptor;
    this.cache = cache;
  }

  /**
   * Deep core: decrypt a batch of messages into typed outcomes, distinguishing
   * a real decrypt failure from a not-encrypted record and a missing slot — the
   * distinction the legacy `(DecryptedMessage | null)[]` shape threw away.
   *
   * Caching is unchanged: a negative result is still cached as a content-null
   * placeholder so it is not re-attempted (and is cleared on key change via the
   * cache). A cached content-null is therefore reported as `decrypt-failed`,
   * the dominant case, since the cache does not retain which reason produced it.
   */
  async decryptMessageOutcomes(
    messages: ApiMessage[],
  ): Promise<MessageDecryptOutcome[]> {
    const results: MessageDecryptOutcome[] = new Array(messages.length);
    const toDecrypt: { index: number; message: ApiMessage }[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message) {
        results[i] = { ok: false, reason: "missing", seq: null, id: null };
        continue;
      }

      const cached = this.cache.getCachedMessage(message.id);
      if (cached) {
        results[i] =
          cached.content === null
            ? {
                ok: false,
                reason: "decrypt-failed",
                seq: message.seq,
                id: message.id,
              }
            : { ok: true, message: cached };
      } else if (message.content.t === "encrypted") {
        toDecrypt.push({ index: i, message });
      } else {
        this.cache.setCachedMessage(message.id, this.placeholderFor(message));
        results[i] = {
          ok: false,
          reason: "not-encrypted",
          seq: message.seq,
          id: message.id,
        };
      }
    }

    // Batch decrypt uncached messages
    if (toDecrypt.length > 0) {
      const encrypted = toDecrypt.map((item) =>
        decodeBase64(item.message.content.c, "base64"),
      );

      const decrypted = await this.encryptor.decrypt(encrypted);

      for (let i = 0; i < toDecrypt.length; i++) {
        const decryptedData = decrypted[i];
        const { message, index } = toDecrypt[i];

        if (decryptedData) {
          const result: DecryptedMessage = {
            id: message.id,
            seq: message.seq,
            localId: message.localId ?? null,
            content: decryptedData,
            createdAt: message.createdAt,
          };
          this.cache.setCachedMessage(message.id, result);
          results[index] = { ok: true, message: result };
        } else {
          this.cache.setCachedMessage(message.id, this.placeholderFor(message));
          results[index] = {
            ok: false,
            reason: "decrypt-failed",
            seq: message.seq,
            id: message.id,
          };
        }
      }
    }

    return results;
  }

  private placeholderFor(message: ApiMessage): DecryptedMessage {
    return {
      id: message.id,
      seq: message.seq,
      localId: message.localId ?? null,
      content: null,
      createdAt: message.createdAt,
    };
  }

  /**
   * Encrypt a raw record
   */
  async encryptRawRecord(record: RawRecord): Promise<string> {
    return encryptValue(this.encryptor, record);
  }

  /**
   * Encrypt raw data using session-specific encryption
   */
  async encryptRaw(data: any): Promise<string> {
    return encryptValue(this.encryptor, data);
  }

  /**
   * Decrypt raw data using session-specific encryption
   */
  async decryptRaw(encrypted: string): Promise<any | null> {
    return decryptValueSafe(this.encryptor, encrypted);
  }

  /**
   * Encrypt metadata using session-specific encryption
   */
  async encryptMetadata(metadata: Metadata): Promise<string> {
    return encryptValue(this.encryptor, metadata);
  }

  /**
   * Decrypt metadata using session-specific encryption
   */
  async decryptMetadata(
    version: number,
    encrypted: string,
  ): Promise<Metadata | null> {
    // Check cache first
    const cached = this.cache.getCachedMetadata(this.sessionId, version);
    if (cached) {
      return cached;
    }

    // Decrypt if not cached
    const decrypted = await decryptValue(this.encryptor, encrypted);
    if (decrypted === null) {
      return null;
    }
    const parsed = MetadataSchema.safeParse(decrypted);
    if (!parsed.success) {
      return null;
    }

    // Cache the result
    this.cache.setCachedMetadata(this.sessionId, version, parsed.data);
    return parsed.data;
  }

  /**
   * Encrypt agent state using session-specific encryption
   */
  async encryptAgentState(state: AgentState): Promise<string> {
    return encryptValue(this.encryptor, state);
  }

  /**
   * Decrypt agent state using session-specific encryption
   */
  async decryptAgentState(
    version: number,
    encrypted: string | null | undefined,
  ): Promise<AgentState> {
    if (!encrypted) {
      return {};
    }

    // Check cache first
    const cached = this.cache.getCachedAgentState(this.sessionId, version);
    if (cached) {
      return cached;
    }

    // Decrypt if not cached
    const decrypted = await decryptValue(this.encryptor, encrypted);
    if (decrypted === null) {
      return {};
    }
    const parsed = AgentStateSchema.safeParse(decrypted);
    if (!parsed.success) {
      return {};
    }

    // Cache the result
    this.cache.setCachedAgentState(this.sessionId, version, parsed.data);
    return parsed.data;
  }

  /**
   * Encrypt session preferences using session-specific encryption
   */
  async encryptPreferences(preferences: SessionPreferences): Promise<string> {
    return encryptValue(this.encryptor, preferences);
  }

  /**
   * Decrypt session preferences using session-specific encryption
   */
  async decryptPreferences(
    encrypted: string | null | undefined,
  ): Promise<SessionPreferences | null> {
    if (!encrypted) {
      return null;
    }

    try {
      const decrypted = await decryptValue(this.encryptor, encrypted);
      if (decrypted === null) {
        return null;
      }
      const parsed = SessionPreferencesSchema.safeParse(decrypted);
      if (!parsed.success) {
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }
}
