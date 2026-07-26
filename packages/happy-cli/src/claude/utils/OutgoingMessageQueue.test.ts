import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OutgoingMessageQueue } from './OutgoingMessageQueue';

/**
 * Pins the three time-ordering invariants this deep module owns:
 *   1. strict FIFO by enqueue order,
 *   2. a delayed (unreleased) head blocks everything behind it until its
 *      delay elapses (head-of-line ordering),
 *   3. a tool-call completion releases a delayed message early — before its
 *      delay timer would have fired.
 * Plus the system-message drop and flush/destroy lifecycle.
 *
 * These run on FAKE timers. The queue reaches "sent" through three chained
 * async hops — the fire-and-forget `lock.inLock()` inside `enqueue()`, the
 * `setTimeout(0)` in `scheduleProcessing()`, and a second lock acquisition in
 * `processQueue()` — and `AsyncLock.unlock()` itself hands the lock over via
 * another `setTimeout(0)`. Waiting a fixed wall-clock 20ms for that chain was
 * a bet that lost whenever the suite ran in parallel and the event loop was
 * congested, which is what made this file intermittently red. Advancing fake
 * timers drives the same chain deterministically instead.
 */

/** Advance the fake clock and flush the microtasks each timer wakes. */
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

/**
 * Await a queue method while the clock keeps moving.
 *
 * `flush()` and `releaseToolCall()` await the lock, and the lock may need a
 * `setTimeout(0)` to hand over. Awaiting them directly under fake timers would
 * deadlock: nothing advances the clock while the test is blocked. Racing the
 * call against a clock advance keeps both moving.
 */
async function resolveWithTimers<T>(operation: Promise<T>, ms = 50): Promise<T> {
    const advanced = settle(ms);
    const result = await operation;
    await advanced;
    return result;
}

describe('OutgoingMessageQueue', () => {
    let sent: any[];
    let queue: OutgoingMessageQueue;

    beforeEach(() => {
        vi.useFakeTimers();
        sent = [];
        queue = new OutgoingMessageQueue((m) => sent.push(m));
    });

    afterEach(() => {
        queue.destroy();
        vi.useRealTimers();
    });

    it('sends non-delayed messages in strict enqueue (FIFO) order', async () => {
        queue.enqueue({ type: 'user', tag: 'a' });
        queue.enqueue({ type: 'user', tag: 'b' });
        queue.enqueue({ type: 'user', tag: 'c' });

        await settle(20);

        expect(sent.map((m) => m.tag)).toEqual(['a', 'b', 'c']);
    });

    it('a delayed head blocks later released messages (head-of-line ordering)', async () => {
        // Effectively "never within the test" delay on the head.
        queue.enqueue({ type: 'user', tag: 'head' }, { delay: 10_000 });
        queue.enqueue({ type: 'user', tag: 'behind' }); // released immediately

        await settle(20);

        // 'behind' is released but cannot jump ahead of the unreleased head.
        expect(sent).toEqual([]);
    });

    it('auto-releases a delayed message after its delay elapses', async () => {
        queue.enqueue({ type: 'user', tag: 'late' }, { delay: 30 });

        await settle(10);
        expect(sent).toEqual([]); // before the delay

        await settle(50);
        expect(sent.map((m) => m.tag)).toEqual(['late']); // after the delay
    });

    it('releaseToolCall releases a delayed message early, before its timer fires', async () => {
        queue.enqueue({ type: 'user', tag: 'tool' }, { delay: 10_000, toolCallIds: ['t1'] });

        await settle(10);
        expect(sent).toEqual([]); // still waiting on the long delay

        await resolveWithTimers(queue.releaseToolCall('t1'));
        await settle(20);

        expect(sent.map((m) => m.tag)).toEqual(['tool']); // released ~10s early
    });

    it('releaseToolCallIds on enqueue atomically unblocks a prior delayed head, preserving order', async () => {
        // The head-of-line race fix: releasing + enqueuing in one lock so the
        // new message never overtakes the message it just unblocked.
        queue.enqueue({ type: 'user', tag: 'first' }, { delay: 10_000, toolCallIds: ['t1'] });
        queue.enqueue({ type: 'user', tag: 'second' }, { releaseToolCallIds: ['t1'] });

        await settle(20);

        expect(sent.map((m) => m.tag)).toEqual(['first', 'second']);
    });

    it('drops system messages without sending, but still unblocks the queue', async () => {
        queue.enqueue({ type: 'system', tag: 'sys' });
        queue.enqueue({ type: 'user', tag: 'real' });

        await settle(20);

        // system is consumed (removed) but not sent; 'real' is unblocked.
        expect(sent.map((m) => m.tag)).toEqual(['real']);
    });

    it('flush() sends everything immediately, ignoring outstanding delays', async () => {
        queue.enqueue({ type: 'user', tag: 'x' }, { delay: 10_000 });
        queue.enqueue({ type: 'user', tag: 'y' }, { delay: 10_000 });

        await resolveWithTimers(queue.flush());

        expect(sent.map((m) => m.tag)).toEqual(['x', 'y']);
    });

    it('destroy() cancels an already-registered delay timer so the message never sends', async () => {
        queue.enqueue({ type: 'user', tag: 'z' }, { delay: 30 });
        await settle(5); // let enqueue's async lock register the delay timer first
        queue.destroy();

        await settle(60); // past the original delay

        expect(sent).toEqual([]);
    });
});
