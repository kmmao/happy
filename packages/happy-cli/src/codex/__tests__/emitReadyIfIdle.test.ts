import { describe, expect, it, vi } from 'vitest';
import {
    emitReadyIfIdle,
    extractCodexResponseText,
    registerCodexControlHandlers,
} from '../runCodex';


describe('emitReadyIfIdle', () => {
    it('emits ready and notification when queue is idle', () => {
        const sendReady = vi.fn();
        const notify = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: null,
            queueSize: () => 0,
            shouldExit: false,
            sendReady,
            notify,
        });

        expect(emitted).toBe(true);
        expect(sendReady).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('skips when a message is still pending', () => {
        const sendReady = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: {},
            queueSize: () => 0,
            shouldExit: false,
            sendReady,
        });

        expect(emitted).toBe(false);
        expect(sendReady).not.toHaveBeenCalled();
    });

    it('skips when queue still has items', () => {
        const sendReady = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: null,
            queueSize: () => 2,
            shouldExit: false,
            sendReady,
        });

        expect(emitted).toBe(false);
        expect(sendReady).not.toHaveBeenCalled();
    });

    it('skips when shutdown is requested', () => {
        const sendReady = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: null,
            queueSize: () => 0,
            shouldExit: true,
            sendReady,
        });

        expect(emitted).toBe(false);
        expect(sendReady).not.toHaveBeenCalled();
    });
});


describe('registerCodexControlHandlers', () => {
    it('registers both abort and interrupt handlers to the same callback', () => {
        const registerHandler = vi.fn();

        registerCodexControlHandlers({
            rpcHandlerManager: {
                registerHandler,
            },
            handleAbort: vi.fn(),
        });

        expect(registerHandler).toHaveBeenCalledTimes(2);
        expect(registerHandler).toHaveBeenNthCalledWith(
            1,
            'abort',
            expect.any(Function),
        );
        expect(registerHandler).toHaveBeenNthCalledWith(
            2,
            'interrupt',
            expect.any(Function),
        );
        expect(registerHandler.mock.calls[0]?.[1]).toBe(
            registerHandler.mock.calls[1]?.[1],
        );
    });

    it('invokes handleAbort when interrupt handler runs', async () => {
        const registerHandler = vi.fn();
        const handleAbort = vi.fn(async () => {});

        registerCodexControlHandlers({
            rpcHandlerManager: {
                registerHandler,
            },
            handleAbort,
        });

        const interruptHandler = registerHandler.mock.calls.find(
            ([name]) => name === 'interrupt',
        )?.[1];

        await interruptHandler?.({});

        expect(handleAbort).toHaveBeenCalledTimes(1);
    });
});

describe('extractCodexResponseText', () => {
    it('joins text fragments and ignores non-text entries', () => {
        const text = extractCodexResponseText({
            content: [
                { type: 'text', text: ' first ' },
                { type: 'image', data: 'ignored' },
                { type: 'text', text: 'second' },
            ],
        });

        expect(text).toBe('first\nsecond');
    });

    it('returns empty string when no text payload exists', () => {
        const text = extractCodexResponseText({
            content: [{ type: 'resource', data: { ok: false } }],
        });

        expect(text).toBe('');
    });
});
