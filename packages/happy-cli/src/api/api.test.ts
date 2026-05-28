import { describe, it, beforeEach, expect, vi } from 'vitest';
import { ApiClient } from './api';
import { logger } from '@/ui/logger';
import { connectionState } from '@/utils/serverConnectionErrors';

// Use vi.hoisted to ensure mock functions are available when vi.mock factory runs
const { mockPost, mockIsAxiosError } = vi.hoisted(() => ({
    mockPost: vi.fn(),
    mockIsAxiosError: vi.fn(() => true)
}));

vi.mock('axios', () => ({
    default: {
        post: mockPost,
        isAxiosError: mockIsAxiosError
    },
    isAxiosError: mockIsAxiosError
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn()
    }
}));

// Mock encryption utilities
vi.mock('./encryption', () => ({
    encodeBase64: vi.fn((data: any) => data),
    getRandomBytes: vi.fn((size: number) => new Uint8Array(size)),
    libsodiumEncryptForPublicKey: vi.fn((data: Uint8Array) => data),
    createCipher: vi.fn(() => ({
        encrypt: vi.fn((data: any) => data),
        decrypt: vi.fn((data: any) => ({ ok: true, value: data })),
    })),
}));

// Mock configuration
vi.mock('./configuration', () => ({
    configuration: {
        serverUrl: 'https://api.example.com'
    }
}));

// Mock libsodium encryption
vi.mock('./libsodiumEncryption', () => ({
    libsodiumEncryptForPublicKey: vi.fn((_data: any) => new Uint8Array(32))
}));

// Global test metadata
const testMetadata = {
    path: '/tmp',
    host: 'localhost',
    homeDir: '/home/user',
    happyHomeDir: '/home/user/.happy',
    happyLibDir: '/home/user/.happy/lib',
    happyToolsDir: '/home/user/.happy/tools'
};

const testMachineMetadata = {
    host: 'localhost',
    platform: 'darwin',
    happyCliVersion: '1.0.0',
    homeDir: '/home/user',
    happyHomeDir: '/home/user/.happy',
    happyLibDir: '/home/user/.happy/lib'
};

describe('Api server error handling', () => {
    let api: ApiClient;

    beforeEach(async () => {
        vi.clearAllMocks();
        connectionState.reset(); // Reset offline state between tests

        // Create a mock credential
        const mockCredential = {
            token: 'fake-token',
            encryption: {
                type: 'legacy' as const,
                secret: new Uint8Array(32)
            }
        };

        api = await ApiClient.create(mockCredential);
    });

    describe('getOrCreateSession', () => {
        it('should return null when Happy server is unreachable (ECONNREFUSED)', async () => {
            vi.mocked(logger.warn).mockClear();

            // Mock axios to throw connection refused error
            mockPost.mockRejectedValue({ code: 'ECONNREFUSED' });

            const result = await api.getOrCreateSession({
                tag: 'test-tag',
                metadata: testMetadata,
                state: null
            });

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Claude server unreachable')
            );
        });

        it('should return null when Happy server cannot be found (ENOTFOUND)', async () => {
            connectionState.reset();
            vi.mocked(logger.warn).mockClear();

            // Mock axios to throw DNS resolution error
            mockPost.mockRejectedValue({ code: 'ENOTFOUND' });

            const result = await api.getOrCreateSession({
                tag: 'test-tag',
                metadata: testMetadata,
                state: null
            });

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Claude server unreachable')
            );
        });

        it('should return null when Happy server times out (ETIMEDOUT)', async () => {
            connectionState.reset();
            vi.mocked(logger.warn).mockClear();

            // Mock axios to throw timeout error
            mockPost.mockRejectedValue({ code: 'ETIMEDOUT' });

            const result = await api.getOrCreateSession({
                tag: 'test-tag',
                metadata: testMetadata,
                state: null
            });

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Claude server unreachable')
            );
        });

        it('should return null when session endpoint returns 404', async () => {
            connectionState.reset();
            vi.mocked(logger.warn).mockClear();

            // Mock axios to return 404
            mockPost.mockRejectedValue({
                response: { status: 404 },
                isAxiosError: true
            });

            const result = await api.getOrCreateSession({
                tag: 'test-tag',
                metadata: testMetadata,
                state: null
            });

            expect(result).toBeNull();
            // New unified format via connectionState.fail() → logger.warn
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Claude server unreachable')
            );
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Session creation failed: 404')
            );
        });

        it('should return null when server returns 500 Internal Server Error', async () => {
            connectionState.reset();
            vi.mocked(logger.warn).mockClear();

            // Mock axios to return 500 error
            mockPost.mockRejectedValue({
                response: { status: 500 },
                isAxiosError: true
            });

            const result = await api.getOrCreateSession({
                tag: 'test-tag',
                metadata: testMetadata,
                state: null
            });

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Claude server unreachable')
            );
        });

        it('should return null when server returns 503 Service Unavailable', async () => {
            connectionState.reset();
            vi.mocked(logger.warn).mockClear();

            // Mock axios to return 503 error
            mockPost.mockRejectedValue({
                response: { status: 503 },
                isAxiosError: true
            });

            const result = await api.getOrCreateSession({
                tag: 'test-tag',
                metadata: testMetadata,
                state: null
            });

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Claude server unreachable')
            );
        });

        it('should re-throw non-connection errors', async () => {
            vi.mocked(logger.warn).mockClear();

            // Mock axios to throw a different type of error (e.g., authentication error)
            const authError = new Error('Invalid API key');
            (authError as any).code = 'UNAUTHORIZED';
            mockPost.mockRejectedValue(authError);

            await expect(
                api.getOrCreateSession({ tag: 'test-tag', metadata: testMetadata, state: null })
            ).rejects.toThrow('Failed to get or create session: Invalid API key');

            // Should not show the offline mode message
            expect(logger.warn).not.toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Claude server unreachable')
            );
        });
    });

    describe('getOrCreateMachine', () => {
        it('should return minimal machine object when server is unreachable (ECONNREFUSED)', async () => {
            connectionState.reset();
            vi.mocked(logger.warn).mockClear();

            // Mock axios to throw connection refused error
            mockPost.mockRejectedValue({ code: 'ECONNREFUSED' });

            const result = await api.getOrCreateMachine({
                machineId: 'test-machine',
                metadata: testMachineMetadata,
                daemonState: {
                    status: 'running',
                    pid: 1234
                }
            });

            expect(result).toEqual({
                id: 'test-machine',
                encryptionKey: expect.any(Uint8Array),
                encryptionVariant: 'legacy',
                metadata: testMachineMetadata,
                metadataVersion: 0,
                daemonState: {
                    status: 'running',
                    pid: 1234
                },
                daemonStateVersion: 0,
            });

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Claude server unreachable')
            );
        });

        it('should return minimal machine object when server endpoint returns 404', async () => {
            connectionState.reset();
            vi.mocked(logger.warn).mockClear();

            // Mock axios to return 404
            mockPost.mockRejectedValue({
                response: { status: 404 },
                isAxiosError: true
            });

            const result = await api.getOrCreateMachine({
                machineId: 'test-machine',
                metadata: testMachineMetadata
            });

            expect(result).toEqual({
                id: 'test-machine',
                encryptionKey: expect.any(Uint8Array),
                encryptionVariant: 'legacy',
                metadata: testMachineMetadata,
                metadataVersion: 0,
                daemonState: null,
                daemonStateVersion: 0,
            });

            // New unified format via connectionState.fail() → logger.warn
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('⚠️  Claude server unreachable')
            );
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Machine registration failed: 404')
            );
        });
    });
});