import { describe, expect, it, vi } from 'vitest';

vi.mock('@/log', () => ({
    log: vi.fn(),
}));

import { ApiEphemeralUpdateSchema, ApiUpdateSchema } from './apiTypes';

describe('ApiUpdateSchema', () => {
    it('accepts shared wire update-session payload', () => {
        const parsed = ApiUpdateSchema.safeParse({
            t: 'update-session',
            id: 'session-1',
        });
        expect(parsed.success).toBe(true);
    });

    it('accepts app-local new-session payload', () => {
        const parsed = ApiUpdateSchema.safeParse({
            t: 'new-session',
            id: 'session-2',
            createdAt: 1,
            updatedAt: 1,
        });
        expect(parsed.success).toBe(true);
    });
});

describe('ApiEphemeralUpdateSchema', () => {

    it('keeps task-status-changed backward compatible when machineId is missing', () => {
        const parsed = ApiEphemeralUpdateSchema.safeParse({
            type: 'task-status-changed',
            taskId: 'task-1',
            status: 'running',
            sessionId: 'session-1',
        });
        expect(parsed.success).toBe(true);
    });
});

