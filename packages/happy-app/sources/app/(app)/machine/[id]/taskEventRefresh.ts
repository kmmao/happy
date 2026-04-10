export function createTaskEventRefreshRetrier(
    refresh: () => Promise<boolean>,
    opts?: { intervalMs?: number },
) {
    const intervalMs = opts?.intervalMs ?? 3000;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let queued = false;

    const clearTimer = () => {
        if (!timer) return;
        clearTimeout(timer);
        timer = null;
    };

    const schedule = () => {
        if (disposed || timer) return;
        timer = setTimeout(() => {
            timer = null;
            void run();
        }, intervalMs);
    };

    const run = async () => {
        if (disposed) return;
        if (running) {
            queued = true;
            return;
        }
        running = true;
        let shouldRetry = false;
        try {
            const ok = await refresh();
            if (disposed) return;
            shouldRetry = !ok;
        } finally {
            running = false;
        }
        if (disposed) return;
        if (queued) {
            queued = false;
            clearTimer();
            void run();
            return;
        }
        if (shouldRetry) {
            schedule();
            return;
        }
        clearTimer();
    };

    return {
        trigger() {
            clearTimer();
            void run();
        },
        dispose() {
            disposed = true;
            queued = false;
            clearTimer();
        },
    };
}
