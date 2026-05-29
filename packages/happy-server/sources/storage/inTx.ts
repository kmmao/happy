import { Prisma } from "@prisma/client";
import { delay } from "@/utils/delay";
import { db } from "@/storage/db";
import { log } from "@/utils/log";

export type Tx = Prisma.TransactionClient;

/**
 * A callback to run after the surrounding transaction commits. May be async —
 * inTx awaits it. These run AFTER commit, so they must not assume they can roll
 * the transaction back; they are for post-commit side effects (notifications).
 */
export type AfterCommit = () => void | Promise<void>;

// Per-transaction list of after-commit callbacks. A WeakMap keyed by the tx
// object keeps this off the tx itself (no `as any` mutation) and lets afterTx
// detect a tx that was never seeded by inTx.
const afterCommitCallbacks = new WeakMap<Tx, AfterCommit[]>();

/**
 * Register a callback to run after the current transaction commits. Must be
 * called while inside the `inTx(fn)` callback for the same `tx` — the list is
 * seeded by inTx. Calling it on a tx that was not produced by inTx is a
 * programming error and throws, rather than silently dropping the callback.
 */
export function afterTx(tx: Tx, callback: AfterCommit) {
    const callbacks = afterCommitCallbacks.get(tx);
    if (!callbacks) {
        throw new Error(
            "afterTx called outside of inTx: the transaction was not created by inTx, " +
            "so the after-commit callback would never run.",
        );
    }
    callbacks.push(callback);
}

export async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    let counter = 0;
    let wrapped = async (tx: Tx) => {
        afterCommitCallbacks.set(tx, []);
        let result = await fn(tx);
        let callbacks = afterCommitCallbacks.get(tx)!;
        afterCommitCallbacks.delete(tx);
        return { result, callbacks };
    }
    while (true) {
        try {
            let result = await db.$transaction(wrapped, { isolationLevel: 'Serializable', timeout: 10000 });
            for (let callback of result.callbacks) {
                // The transaction has already committed; an after-commit callback
                // failing must not undo committed data. We await each callback so
                // async errors are caught here (previously async callbacks were
                // fire-and-forget, so their rejections escaped as unhandled), but
                // we keep going on failure and surface it as a warning rather than
                // swallowing it — these callbacks emit client updates, and a
                // silent failure means a client silently misses an update.
                try {
                    await callback();
                } catch (e) {
                    log({ module: 'inTx', level: 'error' }, 'after-commit callback failed (data is committed; a client update may have been dropped)', e instanceof Error ? e.message : String(e));
                }
            }
            return result.result;
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError) {
                if (e.code === 'P2034' && counter < 3) {
                    counter++;
                    await delay(counter * 100);
                    continue;
                }
            }
            throw e;
        }
    }
}