import { describe, expect, it } from 'vitest';
import {
  acquireMergeLock,
  releaseMergeLock,
  getMergeQueueStatus,
  MergeQueueAbortedError,
} from './mergeQueue';

// Each test uses a unique branch name to avoid cross-test state interference.
let branchCounter = 0;
function uniqueBranch(): string {
  return `test-branch-${++branchCounter}`;
}

describe('mergeQueue', () => {
  describe('acquireMergeLock', () => {
    it('resolves immediately when branch is free', async () => {
      const branch = uniqueBranch();
      await expect(acquireMergeLock(branch, 'action-1')).resolves.toBeUndefined();
      releaseMergeLock(branch);
    });

    it('sets holder after acquiring', async () => {
      const branch = uniqueBranch();
      await acquireMergeLock(branch, 'action-a');
      expect(getMergeQueueStatus(branch).holder).toBe('action-a');
      releaseMergeLock(branch);
    });

    it('queues second acquire until first is released', async () => {
      const branch = uniqueBranch();
      await acquireMergeLock(branch, 'action-1');

      let secondResolved = false;
      const second = acquireMergeLock(branch, 'action-2').then(() => {
        secondResolved = true;
      });

      // Give the event loop a tick — second should NOT have resolved yet
      await Promise.resolve();
      expect(secondResolved).toBe(false);
      expect(getMergeQueueStatus(branch).queued).toBe(1);

      releaseMergeLock(branch);
      await second;

      expect(secondResolved).toBe(true);
      releaseMergeLock(branch); // release action-2
    });

    it('serializes multiple acquires FIFO (A → B → C)', async () => {
      const branch = uniqueBranch();
      const order: string[] = [];

      await acquireMergeLock(branch, 'A');

      const bDone = acquireMergeLock(branch, 'B').then(() => {
        order.push('B');
        releaseMergeLock(branch);
      });
      const cDone = acquireMergeLock(branch, 'C').then(() => {
        order.push('C');
        releaseMergeLock(branch);
      });

      // Release A — B should get lock next
      order.push('A');
      releaseMergeLock(branch);

      await Promise.all([bDone, cDone]);
      expect(order).toEqual(['A', 'B', 'C']);
    });

    it('rejects immediately when signal is already aborted', async () => {
      const branch = uniqueBranch();
      await acquireMergeLock(branch, 'holder');

      const ac = new AbortController();
      ac.abort();

      await expect(
        acquireMergeLock(branch, 'aborted', ac.signal),
      ).rejects.toBeInstanceOf(MergeQueueAbortedError);

      releaseMergeLock(branch);
    });

    it('cancels a queued entry when signal is aborted', async () => {
      const branch = uniqueBranch();
      await acquireMergeLock(branch, 'holder');

      const ac = new AbortController();
      const pending = acquireMergeLock(branch, 'will-cancel', ac.signal);

      expect(getMergeQueueStatus(branch).queued).toBe(1);

      ac.abort();
      await expect(pending).rejects.toBeInstanceOf(MergeQueueAbortedError);

      // Queue should be empty
      expect(getMergeQueueStatus(branch).queued).toBe(0);

      releaseMergeLock(branch);
    });

    it('skips aborted entry and grants lock to next waiter', async () => {
      const branch = uniqueBranch();
      await acquireMergeLock(branch, 'holder');

      const ac = new AbortController();
      const abortedPromise = acquireMergeLock(branch, 'aborted', ac.signal).catch(() => {});
      let nextResolved = false;
      const nextPromise = acquireMergeLock(branch, 'next').then(() => {
        nextResolved = true;
      });

      ac.abort();
      await abortedPromise;

      // 'next' still waiting behind 'holder'
      expect(nextResolved).toBe(false);

      releaseMergeLock(branch); // release 'holder' → grants to 'next'
      await nextPromise;
      expect(nextResolved).toBe(true);
      releaseMergeLock(branch); // release 'next'
    });
  });

  describe('releaseMergeLock', () => {
    it('is a no-op when no lock is held', () => {
      const branch = uniqueBranch();
      expect(() => releaseMergeLock(branch)).not.toThrow();
    });

    it('reports no holder after release with no waiters', async () => {
      const branch = uniqueBranch();
      await acquireMergeLock(branch, 'solo');
      releaseMergeLock(branch);
      expect(getMergeQueueStatus(branch).holder).toBeNull();
      expect(getMergeQueueStatus(branch).queued).toBe(0);
    });
  });

  describe('parallel branches', () => {
    it('allows concurrent acquires on different branches', async () => {
      const branchA = uniqueBranch();
      const branchB = uniqueBranch();

      // Both should resolve without blocking each other
      await Promise.all([
        acquireMergeLock(branchA, 'action-a'),
        acquireMergeLock(branchB, 'action-b'),
      ]);

      expect(getMergeQueueStatus(branchA).holder).toBe('action-a');
      expect(getMergeQueueStatus(branchB).holder).toBe('action-b');

      releaseMergeLock(branchA);
      releaseMergeLock(branchB);
    });
  });

  describe('getMergeQueueStatus', () => {
    it('returns null holder and 0 queued for unknown branch', () => {
      const status = getMergeQueueStatus('nonexistent-branch');
      expect(status.holder).toBeNull();
      expect(status.queued).toBe(0);
    });

    it('reports correct queue depth with multiple waiters', async () => {
      const branch = uniqueBranch();
      await acquireMergeLock(branch, 'holder');

      const p1 = acquireMergeLock(branch, 'w1');
      const p2 = acquireMergeLock(branch, 'w2');

      expect(getMergeQueueStatus(branch).queued).toBe(2);

      releaseMergeLock(branch); // grants to w1
      await Promise.resolve();
      await Promise.resolve();
      expect(getMergeQueueStatus(branch).queued).toBe(1);

      releaseMergeLock(branch); // grants to w2
      await p1;
      await p2;
      releaseMergeLock(branch); // free
    });
  });

  describe('MergeQueueAbortedError', () => {
    it('carries parentBranch and actionId', async () => {
      const branch = uniqueBranch();
      await acquireMergeLock(branch, 'holder');

      const ac = new AbortController();
      ac.abort();

      try {
        await acquireMergeLock(branch, 'victim', ac.signal);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MergeQueueAbortedError);
        const e = err as MergeQueueAbortedError;
        expect(e.parentBranch).toBe(branch);
        expect(e.actionId).toBe('victim');
        expect(e.name).toBe('MergeQueueAbortedError');
      } finally {
        releaseMergeLock(branch);
      }
    });
  });
});
