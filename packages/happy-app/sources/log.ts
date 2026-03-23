/**
 * Simple logging mechanism that maintains internal array for dev/logs page.
 * Does NOT write to console to keep browser/device console clean.
 * Keeps last 5k records in memory with change notifications for UI updates.
 */

function formatArgs(args: unknown[]): string {
    return args
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ');
}

class Logger {
    private logs: string[] = [];
    private maxLogs = 5000;
    private listeners: Array<() => void> = [];

    private push(entry: string): void {
        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        this.listeners.forEach((listener) => listener());
    }

    log(...args: unknown[]): void {
        this.push(formatArgs(args));
    }

    error(...args: unknown[]): void {
        this.push(`[ERROR] ${formatArgs(args)}`);
    }

    warn(...args: unknown[]): void {
        this.push(`[WARN] ${formatArgs(args)}`);
    }

    /**
     * Get all logs as a copy of the array
     */
    getLogs(): string[] {
        return [...this.logs];
    }

    /**
     * Clear all logs
     */
    clear(): void {
        this.logs = [];
        this.listeners.forEach(listener => listener());
    }

    /**
     * Subscribe to log changes - returns unsubscribe function
     */
    onChange(listener: () => void): () => void {
        this.listeners.push(listener);
        return () => {
            const index = this.listeners.indexOf(listener);
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        };
    }

    /**
     * Get current number of logs
     */
    getCount(): number {
        return this.logs.length;
    }
}

// Export singleton instance
export const log = new Logger();