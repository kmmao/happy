import axios from "axios";
import { logger } from "@/ui/logger";
import type {
  AgentState,
  CreateSessionResponse,
  Metadata,
  Session,
  Machine,
  MachineMetadata,
  DaemonState,
} from "@/api/types";
import { CreateSessionResponseSchema } from "@/api/types";
import { ApiSessionClient } from "./apiSession";
import { ApiMachineClient } from "./apiMachine";
import {
  encodeBase64,
  getRandomBytes,
  createCipher,
  libsodiumEncryptForPublicKey,
} from "./encryption";
import { PushNotificationClient } from "./pushNotifications";
import { configuration } from "@/configuration";
import { Credentials } from "@/persistence";
import {
  connectionState,
  isNetworkError,
} from "@/utils/serverConnectionErrors";

/**
 * Some server builds omitted `session.tag` in POST /v1/sessions JSON; the CLI schema requires it.
 * Fill from the request tag so older backends keep working until redeployed.
 */
function withCreateSessionTagFallback(body: unknown, fallbackTag: string): unknown {
  if (!body || typeof body !== "object") {
    return body;
  }
  const o = body as Record<string, unknown>;
  const session = o.session;
  if (!session || typeof session !== "object") {
    return body;
  }
  const s = session as Record<string, unknown>;
  if (typeof s.tag === "string") {
    return body;
  }
  return {
    ...o,
    session: { ...s, tag: fallbackTag },
  };
}

export class ApiClient {
  static async create(credential: Credentials) {
    return new ApiClient(credential);
  }

  private readonly credential: Credentials;
  private readonly pushClient: PushNotificationClient;

  private constructor(credential: Credentials) {
    this.credential = credential;
    this.pushClient = new PushNotificationClient(
      credential.token,
      configuration.serverUrl,
    );
  }

  /**
   * Create a new session or load existing one with the given tag
   */
  async getOrCreateSession(opts: {
    tag: string;
    metadata: Metadata;
    state: AgentState | null;
    machineId?: string;
    path?: string;
  }): Promise<Session | null> {
    // Resolve encryption key
    let dataEncryptionKey: Uint8Array | null = null;
    let encryptionKey: Uint8Array;
    let encryptionVariant: "legacy" | "dataKey";
    if (this.credential.encryption.type === "dataKey") {
      // Generate new encryption key
      encryptionKey = getRandomBytes(32);
      encryptionVariant = "dataKey";

      // Derive and encrypt data encryption key
      // const contentDataKey = await deriveKey(this.secret, 'Happy EnCoder', ['content']);
      // const publicKey = libsodiumPublicKeyFromSecretKey(contentDataKey);
      let encryptedDataKey = libsodiumEncryptForPublicKey(
        encryptionKey,
        this.credential.encryption.publicKey,
      );
      dataEncryptionKey = new Uint8Array(encryptedDataKey.length + 1);
      dataEncryptionKey.set([0], 0); // Version byte
      dataEncryptionKey.set(encryptedDataKey, 1); // Data key
    } else {
      encryptionKey = this.credential.encryption.secret;
      encryptionVariant = "legacy";
    }
    const cipher = createCipher(encryptionKey, encryptionVariant);

    // Create session
    try {
      const response = await axios.post<CreateSessionResponse>(
        `${configuration.serverUrl}/v1/sessions`,
        {
          tag: opts.tag,
          metadata: cipher.encrypt(opts.metadata),
          agentState: opts.state ? cipher.encrypt(opts.state) : null,
          dataEncryptionKey: dataEncryptionKey
            ? encodeBase64(dataEncryptionKey)
            : null,
          machineId: opts.machineId || null,
          path: opts.path || null,
        },
        {
          headers: {
            Authorization: `Bearer ${this.credential.token}`,
            "Content-Type": "application/json",
          },
          timeout: 60000, // 1 minute timeout for very bad network connections
        },
      );

      const parsed = CreateSessionResponseSchema.safeParse(
        withCreateSessionTagFallback(response.data, opts.tag),
      );
      if (!parsed.success) {
        logger.debug("[API] Session response validation failed:", parsed.error.issues);
        throw new Error("Invalid session response from server");
      }
      logger.debug(
        `Session created/loaded: ${parsed.data.session.id} (tag: ${opts.tag})`,
      );
      let raw = parsed.data.session;
      const metadataResult = cipher.decrypt(raw.metadata);
      const agentStateResult = raw.agentState ? cipher.decrypt(raw.agentState) : null;
      let session: Session = {
        id: raw.id,
        seq: raw.seq,
        metadata: metadataResult.ok ? metadataResult.value : null,
        metadataVersion: raw.metadataVersion,
        agentState: agentStateResult?.ok ? agentStateResult.value : null,
        agentStateVersion: raw.agentStateVersion,
        encryptionKey: encryptionKey,
        encryptionVariant: encryptionVariant,
      };
      return session;
    } catch (error) {
      logger.debug("[API] [ERROR] Failed to get or create session:", error);

      // Check if it's a connection error
      if (error && typeof error === "object" && "code" in error) {
        const errorCode = (error as any).code;
        if (isNetworkError(errorCode)) {
          connectionState.fail({
            operation: "Session creation",
            caller: "api.getOrCreateSession",
            errorCode,
            url: `${configuration.serverUrl}/v1/sessions`,
          });
          return null;
        }
      }

      // Handle 404 gracefully - server endpoint may not be available yet
      const is404Error =
        (axios.isAxiosError(error) && error.response?.status === 404) ||
        (error &&
          typeof error === "object" &&
          "response" in error &&
          (error as any).response?.status === 404);
      if (is404Error) {
        connectionState.fail({
          operation: "Session creation",
          errorCode: "404",
          url: `${configuration.serverUrl}/v1/sessions`,
        });
        return null;
      }

      // Handle 5xx server errors - use offline mode with auto-reconnect
      if (axios.isAxiosError(error) && error.response?.status) {
        const status = error.response.status;
        if (status >= 500) {
          connectionState.fail({
            operation: "Session creation",
            errorCode: String(status),
            url: `${configuration.serverUrl}/v1/sessions`,
            details: ["Server encountered an error, will retry automatically"],
          });
          return null;
        }
      }

      throw new Error(
        `Failed to get or create session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Register or update machine with the server
   * Returns the current machine state from the server with decrypted metadata and daemonState
   */
  async getOrCreateMachine(opts: {
    machineId: string;
    metadata: MachineMetadata;
    daemonState?: DaemonState;
  }): Promise<Machine> {
    // Resolve encryption key
    let dataEncryptionKey: Uint8Array | null = null;
    let encryptionKey: Uint8Array;
    let encryptionVariant: "legacy" | "dataKey";
    if (this.credential.encryption.type === "dataKey") {
      // Encrypt data encryption key
      encryptionVariant = "dataKey";
      encryptionKey = this.credential.encryption.machineKey;
      let encryptedDataKey = libsodiumEncryptForPublicKey(
        this.credential.encryption.machineKey,
        this.credential.encryption.publicKey,
      );
      dataEncryptionKey = new Uint8Array(encryptedDataKey.length + 1);
      dataEncryptionKey.set([0], 0); // Version byte
      dataEncryptionKey.set(encryptedDataKey, 1); // Data key
    } else {
      // Legacy encryption
      encryptionKey = this.credential.encryption.secret;
      encryptionVariant = "legacy";
    }
    const cipher = createCipher(encryptionKey, encryptionVariant);

    // Helper to create minimal machine object for offline mode (DRY)
    const createMinimalMachine = (): Machine => ({
      id: opts.machineId,
      encryptionKey: encryptionKey,
      encryptionVariant: encryptionVariant,
      metadata: opts.metadata,
      metadataVersion: 0,
      daemonState: opts.daemonState || null,
      daemonStateVersion: 0,
    });

    // Create machine
    try {
      const response = await axios.post(
        `${configuration.serverUrl}/v1/machines`,
        {
          id: opts.machineId,
          metadata: cipher.encrypt(opts.metadata),
          daemonState: opts.daemonState
            ? cipher.encrypt(opts.daemonState)
            : undefined,
          dataEncryptionKey: dataEncryptionKey
            ? encodeBase64(dataEncryptionKey)
            : undefined,
        },
        {
          headers: {
            Authorization: `Bearer ${this.credential.token}`,
            "Content-Type": "application/json",
          },
          timeout: 60000, // 1 minute timeout for very bad network connections
        },
      );

      const raw = response.data.machine;
      logger.debug(
        `[API] Machine ${opts.machineId} registered/updated with server`,
      );

      // Return decrypted machine like we do for sessions
      const metadataResult = raw.metadata ? cipher.decrypt(raw.metadata) : null;
      const daemonStateResult = raw.daemonState ? cipher.decrypt(raw.daemonState) : null;
      const machine: Machine = {
        id: raw.id,
        encryptionKey: encryptionKey,
        encryptionVariant: encryptionVariant,
        metadata: metadataResult?.ok ? metadataResult.value : null,
        metadataVersion: raw.metadataVersion || 0,
        daemonState: daemonStateResult?.ok ? daemonStateResult.value : null,
        daemonStateVersion: raw.daemonStateVersion || 0,
      };
      return machine;
    } catch (error) {
      // Handle connection errors gracefully
      if (
        axios.isAxiosError(error) &&
        error.code &&
        isNetworkError(error.code)
      ) {
        connectionState.fail({
          operation: "Machine registration",
          caller: "api.getOrCreateMachine",
          errorCode: error.code,
          url: `${configuration.serverUrl}/v1/machines`,
        });
        return createMinimalMachine();
      }

      // Handle 403/409 - server rejected request due to authorization conflict
      // This is NOT "server unreachable" - server responded, so don't use connectionState
      if (axios.isAxiosError(error) && error.response?.status) {
        const status = error.response.status;

        if (status === 403 || status === 409) {
          // Re-auth conflict: machine registered to old account, re-association not allowed
          logger.warn(
            `⚠️  Machine registration rejected by the server with status ${status}`,
          );
          logger.warn(
            `   → This machine ID is already registered to another account on the server`,
          );
          logger.warn(
            `   → This usually happens after re-authenticating with a different account`,
          );
          logger.warn(
            `   → Run 'happy doctor clean' to reset local state and generate a new machine ID`,
          );
          logger.warn(
            `   → Open a GitHub issue if this problem persists`,
          );
          return createMinimalMachine();
        }

        // Handle 5xx - server error, use offline mode with auto-reconnect
        if (status >= 500) {
          connectionState.fail({
            operation: "Machine registration",
            errorCode: String(status),
            url: `${configuration.serverUrl}/v1/machines`,
            details: ["Server encountered an error, will retry automatically"],
          });
          return createMinimalMachine();
        }

        // Handle 404 - endpoint may not be available yet
        if (status === 404) {
          connectionState.fail({
            operation: "Machine registration",
            errorCode: "404",
            url: `${configuration.serverUrl}/v1/machines`,
          });
          return createMinimalMachine();
        }
      }

      // For other errors, rethrow
      throw error;
    }
  }

  /**
   * Internal reconnect handshake for an existing Happy session ID.
   * This is transport/session continuity, not a user-facing restore/unarchive action.
   * Generates a new encryption key and updates the server's dataEncryptionKey
   * only when the previous key is unavailable.
   */
  async reconnectSession(opts: {
    sessionId: string;
    metadata: Metadata;
    state: AgentState | null;
    machineId?: string;
    path?: string;
    existingEncryptionKey?: Uint8Array;
  }): Promise<Session | null> {
    // Resolve encryption key — reuse persisted key when available to avoid
    // invalidating messages that were encrypted with the previous key.
    let dataEncryptionKey: Uint8Array | null = null;
    let encryptionKey: Uint8Array;
    let encryptionVariant: "legacy" | "dataKey";
    if (this.credential.encryption.type === "dataKey") {
      if (opts.existingEncryptionKey) {
        // Reuse persisted key — do NOT send dataEncryptionKey to server
        // so the server keeps the old (identical) encrypted key intact.
        encryptionKey = opts.existingEncryptionKey;
        logger.debug("[API] reconnectSession: reusing persisted encryption key");
      } else {
        encryptionKey = getRandomBytes(32);
        logger.debug("[API] reconnectSession: generated new encryption key (no persisted key found)");
        let encryptedDataKey = libsodiumEncryptForPublicKey(
          encryptionKey,
          this.credential.encryption.publicKey,
        );
        dataEncryptionKey = new Uint8Array(encryptedDataKey.length + 1);
        dataEncryptionKey.set([0], 0);
        dataEncryptionKey.set(encryptedDataKey, 1);
      }
      encryptionVariant = "dataKey";
    } else {
      encryptionKey = this.credential.encryption.secret;
      encryptionVariant = "legacy";
    }
    const cipher = createCipher(encryptionKey, encryptionVariant);

    try {
      const response = await axios.post<CreateSessionResponse>(
        `${configuration.serverUrl}/v1/sessions`,
        {
          tag: "reconnect",
          sessionId: opts.sessionId,
          metadata: cipher.encrypt(opts.metadata),
          agentState: opts.state ? cipher.encrypt(opts.state) : null,
          // Only send dataEncryptionKey when generating a new key.
          // When reusing, server keeps the existing key unchanged.
          dataEncryptionKey: dataEncryptionKey
            ? encodeBase64(dataEncryptionKey)
            : null,
          machineId: opts.machineId || null,
          path: opts.path || null,
        },
        {
          headers: {
            Authorization: `Bearer ${this.credential.token}`,
            "Content-Type": "application/json",
          },
          timeout: 60000,
        },
      );

      const parsed = CreateSessionResponseSchema.safeParse(
        withCreateSessionTagFallback(response.data, "reconnect"),
      );
      if (!parsed.success) {
        logger.debug("[API] Reconnect response validation failed:", parsed.error.issues);
        throw new Error("Invalid session response from server");
      }
      logger.debug(`[API] Reconnected to session: ${parsed.data.session.id}`);
      let raw = parsed.data.session;
      const metadataResult = cipher.decrypt(raw.metadata);
      const agentStateResult = raw.agentState ? cipher.decrypt(raw.agentState) : null;
      let session: Session = {
        id: raw.id,
        seq: raw.seq,
        metadata: metadataResult.ok ? metadataResult.value : null,
        metadataVersion: raw.metadataVersion,
        agentState: agentStateResult?.ok ? agentStateResult.value : null,
        agentStateVersion: raw.agentStateVersion,
        encryptionKey: encryptionKey,
        encryptionVariant: encryptionVariant,
      };
      return session;
    } catch (error) {
      logger.debug("[API] [ERROR] Failed to reconnect session:", error);

      if (error && typeof error === "object" && "code" in error) {
        const errorCode = (error as any).code;
        if (isNetworkError(errorCode)) {
          connectionState.fail({
            operation: "Session reconnect",
            caller: "api.reconnectSession",
            errorCode,
            url: `${configuration.serverUrl}/v1/sessions`,
          });
          return null;
        }
      }

      const is404Error =
        (axios.isAxiosError(error) && error.response?.status === 404) ||
        (error &&
          typeof error === "object" &&
          "response" in error &&
          (error as any).response?.status === 404);
      if (is404Error) {
        connectionState.fail({
          operation: "Session reconnect",
          errorCode: "404",
          url: `${configuration.serverUrl}/v1/sessions`,
        });
        return null;
      }

      if (axios.isAxiosError(error) && error.response?.status) {
        const status = error.response.status;
        if (status >= 500) {
          connectionState.fail({
            operation: "Session reconnect",
            errorCode: String(status),
            url: `${configuration.serverUrl}/v1/sessions`,
            details: ["Server encountered an error, will retry automatically"],
          });
          return null;
        }
      }

      throw new Error(
        `Failed to reconnect session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async getSessionById(opts: {
    sessionId: string;
    existingEncryptionKey?: Uint8Array;
  }): Promise<Session | null> {
    try {
      const response = await axios.get<{
        sessions: Array<{
          id: string;
          seq: number;
          metadata: string;
          metadataVersion: number;
          agentState: string | null;
          agentStateVersion: number;
        }>;
      }>(`${configuration.serverUrl}/v1/sessions`, {
        headers: {
          Authorization: `Bearer ${this.credential.token}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      });

      const raw = response.data.sessions.find(
        (session) => session.id === opts.sessionId,
      );
      if (!raw) {
        return null;
      }

      let encryptionKey: Uint8Array;
      let encryptionVariant: "legacy" | "dataKey";
      if (this.credential.encryption.type === "dataKey") {
        if (!opts.existingEncryptionKey) {
          logger.debug(
            `[API] getSessionById: missing persisted encryption key for ${opts.sessionId}`,
          );
          return null;
        }
        encryptionKey = opts.existingEncryptionKey;
        encryptionVariant = "dataKey";
      } else {
        encryptionKey = this.credential.encryption.secret;
        encryptionVariant = "legacy";
      }
      const cipher = createCipher(encryptionKey, encryptionVariant);

      const metadataResult = cipher.decrypt(raw.metadata);
      const agentStateResult = raw.agentState ? cipher.decrypt(raw.agentState) : null;
      return {
        id: raw.id,
        seq: raw.seq,
        metadata: metadataResult.ok ? metadataResult.value : null,
        metadataVersion: raw.metadataVersion,
        agentState: agentStateResult?.ok ? agentStateResult.value : null,
        agentStateVersion: raw.agentStateVersion,
        encryptionKey,
        encryptionVariant,
      };
    } catch (error) {
      logger.debug("[API] Failed to fetch session by id:", error);
      return null;
    }
  }

  sessionSyncClient(session: Session): ApiSessionClient {
    return new ApiSessionClient(this.credential.token, session);
  }

  machineSyncClient(machine: Machine): ApiMachineClient {
    return new ApiMachineClient(this.credential.token, machine);
  }

  push(): PushNotificationClient {
    return this.pushClient;
  }

  /**
   * Register a vendor API token with the server
   * The token is sent as a JSON string - server handles encryption
   */
  async registerVendorToken(
    vendor: "openai" | "anthropic" | "gemini",
    apiKey: any,
  ): Promise<void> {
    try {
      const response = await axios.post(
        `${configuration.serverUrl}/v1/connect/${vendor}/register`,
        {
          token: JSON.stringify(apiKey),
        },
        {
          headers: {
            Authorization: `Bearer ${this.credential.token}`,
            "Content-Type": "application/json",
          },
          timeout: 5000,
        },
      );

      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`Server returned status ${response.status}`);
      }

      logger.debug(`[API] Vendor token for ${vendor} registered successfully`);
    } catch (error) {
      logger.debug(`[API] [ERROR] Failed to register vendor token:`, error);
      throw new Error(
        `Failed to register vendor token: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get vendor API token from the server
   * Returns the token if it exists, null otherwise
   */
  async getVendorToken(
    vendor: "openai" | "anthropic" | "gemini",
  ): Promise<any | null> {
    try {
      const response = await axios.get(
        `${configuration.serverUrl}/v1/connect/${vendor}/token`,
        {
          headers: {
            Authorization: `Bearer ${this.credential.token}`,
            "Content-Type": "application/json",
          },
          timeout: 5000,
        },
      );

      if (response.status === 404) {
        logger.debug(`[API] No vendor token found for ${vendor}`);
        return null;
      }

      if (response.status !== 200) {
        throw new Error(`Server returned status ${response.status}`);
      }

      // Log raw response for debugging
      logger.debug(`[API] Raw vendor token response:`, {
        status: response.status,
        dataKeys: Object.keys(response.data || {}),
        hasToken: "token" in (response.data || {}),
        tokenType: typeof response.data?.token,
      });

      // Token is returned as JSON string, parse it
      let tokenData: any = null;
      if (response.data?.token) {
        if (typeof response.data.token === "string") {
          try {
            tokenData = JSON.parse(response.data.token);
          } catch (parseError) {
            logger.debug(
              `[API] Failed to parse token as JSON, using as string:`,
              parseError,
            );
            tokenData = response.data.token;
          }
        } else if (response.data.token !== null) {
          // Token exists and is not null
          tokenData = response.data.token;
        } else {
          // Token is explicitly null - treat as not found
          logger.debug(
            `[API] Token is null for ${vendor}, treating as not found`,
          );
          return null;
        }
      } else if (response.data && typeof response.data === "object") {
        // Maybe the token is directly in response.data
        // But check if it's { token: null } - treat as not found
        if (
          response.data.token === null &&
          Object.keys(response.data).length === 1
        ) {
          logger.debug(
            `[API] Response contains only null token for ${vendor}, treating as not found`,
          );
          return null;
        }
        tokenData = response.data;
      }

      // Final check: if tokenData is null or { token: null }, return null
      if (
        tokenData === null ||
        (tokenData &&
          typeof tokenData === "object" &&
          tokenData.token === null &&
          Object.keys(tokenData).length === 1)
      ) {
        logger.debug(`[API] Token data is null for ${vendor}`);
        return null;
      }

      logger.debug(`[API] Vendor token for ${vendor} retrieved successfully`, {
        tokenDataType: typeof tokenData,
        tokenDataKeys:
          tokenData && typeof tokenData === "object"
            ? Object.keys(tokenData)
            : "not an object",
      });
      return tokenData;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.debug(`[API] No vendor token found for ${vendor}`);
        return null;
      }
      logger.debug(`[API] [ERROR] Failed to get vendor token:`, error);
      return null;
    }
  }

  /**
   * Fetch a single value from the UserKVStore by key.
   * Returns null if the key doesn't exist or on network error.
   * Used by the MCP registry to load persistent server configs on session start.
   */
  async fetchKvValue(key: string): Promise<{ key: string; value: string; version: number } | null> {
    try {
      const response = await axios.get<{ key: string; value: string; version: number }>(
        `${configuration.serverUrl}/v1/kv/${encodeURIComponent(key)}`,
        {
          headers: {
            Authorization: `Bearer ${this.credential.token}`,
            "Content-Type": "application/json",
          },
          timeout: 5000,
        },
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      logger.debug(`[API] fetchKvValue(${key}) failed:`, error);
      return null;
    }
  }
}
