import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OutgoingMessageQueue } from './OutgoingMessageQueue';

/**
 * Pins the three time-ordering invariants this deep module owns:
 *   1. strict FIFO by enqueue order,
 *   2. a delayed (unreleased) head blocks everything behind it until its
 *      delay elapses (head-of-line ordering),
 *   3. a tool-call completion releases a delayed message early — before its
 *      delay timer would have fired.
 * Plus the system-message drop and flush/destroy lifecycle.
 */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('OutgoingMessageQueue', () => {
    let sent: any[];
    let queue: OutgoingMessageQueue;

    beforeEach(() => {
        sent = [];
        queue = new OutgoingMessageQueue((m) => sent.push(m));
    });

    afterEach(() => {
        queue.destroy();
    });

    it('sends non-delayed messages in strict enqueue (FIFO) order', async () => {
        queue.enqueue({ type: 'user', tag: 'a' });
        queue.enqueue({ type: 'user', tag: 'b' });
        queue.enqueue({ type: 'user', tag: 'c' });

        await wait(20);

        expect(sent.map((m) => m.tag)).toEqual(['a', 'b', 'c']);
    });

    it('a delayed head blocks later released messages (head-of-line ordering)', async () => {
        // Effectively "never within the test" delay on the head.
        queue.enqueue({ type: 'user', tag: 'head' }, { delay: 10_000 });
        queue.enqueue({ type: 'user', tag: 'behind' }); // released immediately

        await wait(20);

        // 'behind' is released but cannot jump ahead of the unreleased head.
        expect(sent).toEqual([]);
    });

    it('auto-releases a delayed message after its delay elapses', async () => {
        queue.enqueue({ type: 'user', tag: 'late' }, { delay: 30 });

        await wait(10);
        expect(sent).toEqual([]); // before the delay

        await wait(50);
        expect(sent.map((m) => m.tag)).toEqual(['late']); // after the delay
    });

    it('releaseToolCall releases a delayed message early, before its timer fires', async () => {
        queue.enqueue({ type: 'user', tag: 'tool' }, { delay: 10_000, toolCallIds: ['t1'] });

        await wait(10);
        expect(sent).toEqual([]); // still waiting on the long delay

        await queue.releaseToolCall('t1');
        await wait(20);

        expect(sent.map((m) => m.tag)).toEqual(['tool']); // released ~10s early
    });

    it('releaseToolCallIds on enqueue atomically unblocks a prior delayed head, preserving order', async () => {
        // The head-of-line race fix: releasing + enqueuing in one lock so the
        // new message never overtakes the message it just unblocked.
        queue.enqueue({ type: 'user', tag: 'first' }, { delay: 10_000, toolCallIds: ['t1'] });
        queue.enqueue({ type: 'user', tag: 'second' }, { releaseToolCallIds: ['t1'] });

        await wait(20);

        expect(sent.map((m) => m.tag)).toEqual(['first', 'second']);
    });

    it('drops system messages without sending, but still unblocks the queue', async () => {
        queue.enqueue({ type: 'system', tag: 'sys' });
        queue.enqueue({ type: 'user', tag: 'real' });

        await wait(20);

        // system is consumed (removed) but not sent; 'real' is unblocked.
        expect(sent.map((m) => m.tag)).toEqual(['real']);
    });

    it('flush() sends everything immediately, ignoring outstanding delays', async () => {
        queue.enqueue({ type: 'user', tag: 'x' }, { delay: 10_000 });
        queue.enqueue({ type: 'user', tag: 'y' }, { delay: 10_000 });

        await queue.flush();

        expect(sent.map((m) => m.tag)).toEqual(['x', 'y']);
    });

    it('destroy() cancels an already-registered delay timer so the message never sends', async () => {
        queue.enqueue({ type: 'user', tag: 'z' }, { delay: 30 });
        await wait(5); // let enqueue's async lock register the delay timer first
        queue.destroy();

        await wait(60); // past the original delay

        expect(sent).toEqual([]);
    });
});
