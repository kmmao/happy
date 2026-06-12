import { ingestStorage, storage } from "./storage";
import { log } from "@/log";
import { encodeBase64 } from "@/encryption/base64";
import {
    fetchArtifact,
    fetchArtifacts,
    createArtifact as apiCreateArtifact,
    updateArtifact as apiUpdateArtifact,
} from "./apiArtifacts";
import type {
    DecryptedArtifact,
    ArtifactCreateRequest,
    ArtifactUpdateRequest,
} from "./artifactTypes";
import { ArtifactEncryption } from "./encryption/artifactEncryption";
import type { Encryption } from "./encryption/encryption";
import type { AuthCredentials } from "@/auth/tokenStorage";

/**
 * Context needed by artifact functions to access sync state.
 */
export type ArtifactContext = {
    credentials: AuthCredentials;
    encryption: Encryption;
    artifactDataKeys: Map<string, Uint8Array>;
};

/**
 * Fetch all artifacts from server, decrypt headers, and apply to storage.
 */
export async function fetchArtifactsList(ctx: ArtifactContext): Promise<void> {
    log.log("📦 fetchArtifactsList: Starting artifact sync");

    try {
        log.log("📦 fetchArtifactsList: Fetching artifacts from server");
        const artifacts = await fetchArtifacts(ctx.credentials);
        log.log(
            `📦 fetchArtifactsList: Received ${artifacts.length} artifacts from server`,
        );
        const decryptedArtifacts: DecryptedArtifact[] = [];

        for (const artifact of artifacts) {
            try {
                // Decrypt the data encryption key
                const decryptedKey = await ctx.encryption.decryptEncryptionKey(
                    artifact.dataEncryptionKey,
                );
                if (!decryptedKey) {
                    log.error(`Failed to decrypt key for artifact ${artifact.id}`);
                    continue;
                }

                // Store the decrypted key in memory
                ctx.artifactDataKeys.set(artifact.id, decryptedKey);

                // Create artifact encryption instance
                const artifactEncryption = new ArtifactEncryption(decryptedKey);

                // Decrypt header
                const header = await artifactEncryption.decryptHeader(
                    artifact.header,
                );

                decryptedArtifacts.push({
                    id: artifact.id,
                    title: header?.title || null,
                    sessions: header?.sessions,
                    draft: header?.draft,
                    body: undefined,
                    headerVersion: artifact.headerVersion,
                    bodyVersion: artifact.bodyVersion,
                    seq: artifact.seq,
                    createdAt: artifact.createdAt,
                    updatedAt: artifact.updatedAt,
                    isDecrypted: !!header,
                });
            } catch (err) {
                log.error(`Failed to decrypt artifact ${artifact.id}:`, err);
                decryptedArtifacts.push({
                    id: artifact.id,
                    title: null,
                    body: undefined,
                    headerVersion: artifact.headerVersion,
                    seq: artifact.seq,
                    createdAt: artifact.createdAt,
                    updatedAt: artifact.updatedAt,
                    isDecrypted: false,
                });
            }
        }

        log.log(
            `📦 fetchArtifactsList: Successfully decrypted ${decryptedArtifacts.length} artifacts`,
        );
        ingestStorage.getState().applyArtifacts(decryptedArtifacts, true);
        log.log("📦 fetchArtifactsList: Artifacts applied to storage");
    } catch (error) {
        log.log(`📦 fetchArtifactsList: Error fetching artifacts: ${error}`);
        log.error("Failed to fetch artifacts:", error);
        throw error;
    }
}

/**
 * Fetch a single artifact with body, decrypt, and return.
 */
export async function fetchArtifactWithBody(
    ctx: ArtifactContext,
    artifactId: string,
): Promise<DecryptedArtifact | null> {
    try {
        const artifact = await fetchArtifact(ctx.credentials, artifactId);

        const decryptedKey = await ctx.encryption.decryptEncryptionKey(
            artifact.dataEncryptionKey,
        );
        if (!decryptedKey) {
            log.error(`Failed to decrypt key for artifact ${artifactId}`);
            return null;
        }

        ctx.artifactDataKeys.set(artifact.id, decryptedKey);

        const artifactEncryption = new ArtifactEncryption(decryptedKey);

        const header = await artifactEncryption.decryptHeader(artifact.header);
        const body = artifact.body
            ? await artifactEncryption.decryptBody(artifact.body)
            : null;

        return {
            id: artifact.id,
            title: header?.title || null,
            sessions: header?.sessions,
            draft: header?.draft,
            body: body?.body || null,
            headerVersion: artifact.headerVersion,
            bodyVersion: artifact.bodyVersion,
            seq: artifact.seq,
            createdAt: artifact.createdAt,
            updatedAt: artifact.updatedAt,
            isDecrypted: !!header,
        };
    } catch (error) {
        log.error(`Failed to fetch artifact ${artifactId}:`, error);
        return null;
    }
}

/**
 * Create a new artifact with encrypted header and body.
 * Returns the artifact ID.
 */
export async function createArtifactAction(
    ctx: ArtifactContext,
    title: string | null,
    body: string | null,
    sessions?: string[],
    draft?: boolean,
): Promise<string> {
    try {
        const artifactId = ctx.encryption.generateId();
        const dataEncryptionKey = ArtifactEncryption.generateDataEncryptionKey();

        ctx.artifactDataKeys.set(artifactId, dataEncryptionKey);

        const encryptedKey =
            await ctx.encryption.encryptEncryptionKey(dataEncryptionKey);

        const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);

        const encryptedHeader = await artifactEncryption.encryptHeader({
            title,
            sessions,
            draft,
        });
        const encryptedBody = await artifactEncryption.encryptBody({ body });

        const request: ArtifactCreateRequest = {
            id: artifactId,
            header: encryptedHeader,
            body: encryptedBody,
            dataEncryptionKey: encodeBase64(encryptedKey, "base64"),
        };

        const artifact = await apiCreateArtifact(ctx.credentials, request);

        const decryptedArtifact: DecryptedArtifact = {
            id: artifact.id,
            title,
            sessions,
            draft,
            body,
            headerVersion: artifact.headerVersion,
            bodyVersion: artifact.bodyVersion,
            seq: artifact.seq,
            createdAt: artifact.createdAt,
            updatedAt: artifact.updatedAt,
            isDecrypted: true,
        };

        storage.getState().addArtifact(decryptedArtifact);

        return artifactId;
    } catch (error) {
        log.error("Failed to create artifact:", error);
        throw error;
    }
}

/**
 * Update an existing artifact's header and/or body.
 */
export async function updateArtifactAction(
    ctx: ArtifactContext,
    artifactId: string,
    title: string | null,
    body: string | null,
    sessions?: string[],
    draft?: boolean,
): Promise<void> {
    try {
        const currentArtifact = storage.getState().artifacts[artifactId];
        if (!currentArtifact) {
            throw new Error("Artifact not found");
        }

        let dataEncryptionKey = ctx.artifactDataKeys.get(artifactId);

        let headerVersion = currentArtifact.headerVersion;
        let bodyVersion = currentArtifact.bodyVersion;

        if (
            headerVersion === undefined ||
            bodyVersion === undefined ||
            !dataEncryptionKey
        ) {
            const fullArtifact = await fetchArtifact(ctx.credentials, artifactId);
            headerVersion = fullArtifact.headerVersion;
            bodyVersion = fullArtifact.bodyVersion;

            if (!dataEncryptionKey) {
                const decryptedKey = await ctx.encryption.decryptEncryptionKey(
                    fullArtifact.dataEncryptionKey,
                );
                if (!decryptedKey) {
                    throw new Error("Failed to decrypt encryption key");
                }
                ctx.artifactDataKeys.set(artifactId, decryptedKey);
                dataEncryptionKey = decryptedKey;
            }
        }

        const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);

        const updateRequest: ArtifactUpdateRequest = {};

        if (
            title !== currentArtifact.title ||
            JSON.stringify(sessions) !== JSON.stringify(currentArtifact.sessions) ||
            draft !== currentArtifact.draft
        ) {
            const encryptedHeader = await artifactEncryption.encryptHeader({
                title,
                sessions,
                draft,
            });
            updateRequest.header = encryptedHeader;
            updateRequest.expectedHeaderVersion = headerVersion;
        }

        if (body !== currentArtifact.body) {
            const encryptedBody = await artifactEncryption.encryptBody({ body });
            updateRequest.body = encryptedBody;
            updateRequest.expectedBodyVersion = bodyVersion;
        }

        if (Object.keys(updateRequest).length === 0) {
            return;
        }

        const response = await apiUpdateArtifact(
            ctx.credentials,
            artifactId,
            updateRequest,
        );

        if (!response.success) {
            if (response.error === "version-mismatch") {
                throw new Error(
                    "Artifact was modified by another client. Please refresh and try again.",
                );
            }
            throw new Error("Failed to update artifact");
        }

        const updatedArtifact: DecryptedArtifact = {
            ...currentArtifact,
            title,
            sessions,
            draft,
            body,
            headerVersion:
                response.headerVersion !== undefined
                    ? response.headerVersion
                    : headerVersion,
            bodyVersion:
                response.bodyVersion !== undefined
                    ? response.bodyVersion
                    : bodyVersion,
            updatedAt: Date.now(),
        };

        storage.getState().updateArtifact(updatedArtifact);
    } catch (error) {
        log.error("Failed to update artifact:", error);
        throw error;
    }
}
