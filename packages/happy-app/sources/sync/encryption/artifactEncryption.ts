import { ArtifactHeader, ArtifactBody } from '../artifactTypes';
import { AES256Encryption } from './encryptor';
import { decryptValue, encryptValue } from './codec';
import * as Random from 'expo-crypto';
import { log } from '@/log';

export class ArtifactEncryption {
    private encryptor: AES256Encryption;

    constructor(dataEncryptionKey: Uint8Array) {
        this.encryptor = new AES256Encryption(dataEncryptionKey);
    }

    /**
     * Generate a new data encryption key for an artifact
     */
    static generateDataEncryptionKey(): Uint8Array {
        return Random.getRandomBytes(32);  // 256 bits for AES-256
    }

    /**
     * Encrypt artifact header
     */
    async encryptHeader(header: ArtifactHeader): Promise<string> {
        return encryptValue(this.encryptor, header);
    }

    /**
     * Decrypt artifact header
     */
    async decryptHeader(encryptedHeader: string): Promise<ArtifactHeader | null> {
        try {
            const decrypted = await decryptValue(this.encryptor, encryptedHeader);
            if (decrypted === null) {
                return null;
            }
            // Validate structure
            const header = decrypted as any;
            if (typeof header !== 'object' || header === null) {
                return null;
            }
            return {
                title: typeof header.title === 'string' ? header.title : null
            };
        } catch (error) {
            log.error('Failed to decrypt artifact header:', error);
            return null;
        }
    }

    /**
     * Encrypt artifact body
     */
    async encryptBody(body: ArtifactBody): Promise<string> {
        return encryptValue(this.encryptor, body);
    }

    /**
     * Decrypt artifact body
     */
    async decryptBody(encryptedBody: string): Promise<ArtifactBody | null> {
        try {
            const decrypted = await decryptValue(this.encryptor, encryptedBody);
            if (decrypted === null) {
                return null;
            }
            // Validate structure
            const body = decrypted as any;
            if (typeof body !== 'object' || body === null) {
                return null;
            }
            return {
                body: typeof body.body === 'string' ? body.body : null
            };
        } catch (error) {
            log.error('Failed to decrypt artifact body:', error);
            return null;
        }
    }
}
