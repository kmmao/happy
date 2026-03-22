import { describe, expect, it, vi, beforeEach } from 'vitest';
import { kvSetWithRetry } from './kvConflictRetry';
import type { AuthCredentials } from '@/auth/tokenStorage';
import type { KvMutateResponse } from './apiKv';

// Mock apiKv module
vi.mock('./apiKv', () => ({
    kvMutate: vi.fn(),
}));

import { kvMutate } from './apiKv';

const mockKvMutate = vi.mocked(kvMutate);

const credentials: AuthCredentials = {
    token: 'test-token',
    secret: 'test-secret',
};

describe('kvSetWithRetry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    it('succeeds on first attempt without conflict', async () => {
        const successResponse: KvMutateResponse = {
            success: true,
            results: [{ key: 'test-key', version: 1 }],
        };
        mockKvMutate.mockResolvedValueOnce(successResponse);

        const result = await kvSetWithRetry(
            credentials, 'test-key', '{"data":"value"}', -1,
        );

        expect(result).toEqual({ version: 1, conflictOccurred: false });
        expect(mockKvMutate).toHaveBeenCalledTimes(1);
        expect(mockKvMutate).toHaveBeenCalledWith(credentials, [{
            key: 'test-key',
            value: '{"data":"value"}',
            version: -1,
        }]);
    });

    it('retries on version-mismatch and succeeds on second attempt', async () => {
        const conflictResponse: KvMutateResponse = {
            success: false,
            errors: [{
                key: 'test-key',
                error: 'version-mismatch',
                version: 5,
                value: '{"old":"data"}',
            }],
        };
        const successResponse: KvMutateResponse = {
            success: true,
            results: [{ key: 'test-key', version: 6 }],
        };
        mockKvMutate
            .mockResolvedValueOnce(conflictResponse)
            .mockResolvedValueOnce(successResponse);

        const promise = kvSetWithRetry(
            credentials, 'test-key', '{"new":"data"}', 3,
        );

        // Advance past the first retry delay (100ms)
        await vi.advanceTimersByTimeAsync(100);

        const result = await promise;

        expect(result).toEqual({ version: 6, conflictOccurred: true });
        expect(mockKvMutate).toHaveBeenCalledTimes(2);
        // Second call should use the server's current version
        expect(mockKvMutate).toHaveBeenNthCalledWith(2, credentials, [{
            key: 'test-key',
            value: '{"new":"data"}',
            version: 5,
        }]);
    });

    it('throws after exhausting all retries', async () => {
        const conflictResponse: KvMutateResponse = {
            success: false,
            errors: [{
                key: 'test-key',
                error: 'version-mismatch',
                version: 5,
                value: null,
            }],
        };
        mockKvMutate.mockResolvedValue(conflictResponse);

        const promise = kvSetWithRetry(
            credentials, 'test-key', '{"data":"value"}', 2,
            { maxRetries: 3 },
        );

        // Attach the rejection handler immediately to avoid unhandled rejection
        const rejection = expect(promise).rejects.toThrow(
            'KV set failed after 3 retries: version-mismatch on key "test-key"',
        );

        // Advance through all retry delays: 100ms + 200ms + 400ms
        await vi.advanceTimersByTimeAsync(100);
        await vi.advanceTimersByTimeAsync(200);
        await vi.advanceTimersByTimeAsync(400);

        await rejection;
        // 1 initial + 3 retries = 4 calls
        expect(mockKvMutate).toHaveBeenCalledTimes(4);
    });

    it('uses exponential backoff delays between retries', async () => {
        const conflictResponse: KvMutateResponse = {
            success: false,
            errors: [{
                key: 'test-key',
                error: 'version-mismatch',
                version: 1,
                value: null,
            }],
        };
        const successResponse: KvMutateResponse = {
            success: true,
            results: [{ key: 'test-key', version: 4 }],
        };

        // Fail twice, then succeed
        mockKvMutate
            .mockResolvedValueOnce(conflictResponse)
            .mockResolvedValueOnce({
                ...conflictResponse,
                errors: [{ ...conflictResponse.errors![0], version: 2 }],
            } as KvMutateResponse)
            .mockResolvedValueOnce(successResponse);

        const promise = kvSetWithRetry(
            credentials, 'test-key', 'val', 0,
            { maxRetries: 3 },
        );

        // After 99ms, second call should not have happened yet
        await vi.advanceTimersByTimeAsync(99);
        expect(mockKvMutate).toHaveBeenCalledTimes(1);

        // After 100ms, second call fires
        await vi.advanceTimersByTimeAsync(1);
        expect(mockKvMutate).toHaveBeenCalledTimes(2);

        // After another 199ms, third call should not have happened yet
        await vi.advanceTimersByTimeAsync(199);
        expect(mockKvMutate).toHaveBeenCalledTimes(2);

        // After 200ms total for second retry, third call fires
        await vi.advanceTimersByTimeAsync(1);
        expect(mockKvMutate).toHaveBeenCalledTimes(3);

        const result = await promise;
        expect(result).toEqual({ version: 4, conflictOccurred: true });
    });

    it('defaults to 3 max retries', async () => {
        const conflictResponse: KvMutateResponse = {
            success: false,
            errors: [{
                key: 'test-key',
                error: 'version-mismatch',
                version: 0,
                value: null,
            }],
        };
        mockKvMutate.mockResolvedValue(conflictResponse);

        const promise = kvSetWithRetry(
            credentials, 'test-key', 'val', -1,
        );

        // Attach rejection handler immediately
        const rejection = expect(promise).rejects.toThrow();

        await vi.advanceTimersByTimeAsync(100 + 200 + 400);

        await rejection;
        // 1 initial + 3 retries = 4
        expect(mockKvMutate).toHaveBeenCalledTimes(4);
    });

    it('propagates network errors without retrying', async () => {
        mockKvMutate.mockRejectedValueOnce(new Error('Network error'));

        await expect(
            kvSetWithRetry(credentials, 'test-key', 'val', -1),
        ).rejects.toThrow('Network error');

        expect(mockKvMutate).toHaveBeenCalledTimes(1);
    });
});
