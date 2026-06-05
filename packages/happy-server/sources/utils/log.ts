import pino from 'pino';
import pretty from 'pino-pretty';
import { mkdirSync } from 'fs';
import { readdir, unlink } from 'fs/promises';
import { join } from 'path';

// Single log file name created once at startup
let consolidatedLogFile: string | undefined;

if (process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING) {
    const logsDir = join(process.cwd(), '.logs');
    try {
        mkdirSync(logsDir, { recursive: true });
        // Create filename once at startup
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const sec = String(now.getSeconds()).padStart(2, '0');
        consolidatedLogFile = join(logsDir, `${month}-${day}-${hour}-${min}-${sec}.log`);
        console.log(`[PINO] Remote debugging logs enabled - writing to ${consolidatedLogFile}`);
    } catch (error) {
        console.error('Failed to create logs directory:', error);
    }
}

// Format time as HH:MM:ss.mmm in local time
function formatLocalTime(timestamp?: number) {
    const date = timestamp ? new Date(timestamp) : new Date();
    const hours = String(date.getHours()).padStart(2, '0');
    const mins = String(date.getMinutes()).padStart(2, '0');
    const secs = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${hours}:${mins}:${secs}.${ms}`;
}

const DEFAULT_LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

// Shared pino options: inject localTime into every entry + custom timestamp.
const baseOptions: pino.LoggerOptions = {
    level: DEFAULT_LOG_LEVEL,
    formatters: {
        log: (object: any) => {
            // Add localTime to every log entry
            return {
                ...object,
                localTime: formatLocalTime(typeof object.time === 'number' ? object.time : undefined),
            };
        },
    },
    timestamp: () => `,"time":${Date.now()},"localTime":"${formatLocalTime()}"`,
};

// Pretty console output as a *synchronous, in-process* stream — not a pino
// transport. pino's transport mechanism runs targets inside a worker thread
// that require()s them by file path at runtime; that breaks inside a
// `bun build --compile` single-file binary, where those modules live in the
// bundle and not on disk, so the compiled server fails to start. Building the
// pretty stream directly keeps everything in-process and lets the binary boot.
const prettyStream = pretty({
    colorize: true,
    translateTime: 'HH:MM:ss.l',
    ignore: 'pid,hostname',
    messageFormat: '{msg} | [{time}]',
    errorLikeObjectKeys: ['err', 'error'],
});

const fileEnabled = !!(process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING && consolidatedLogFile);

// When remote debugging is on, tee raw-JSON logs to the consolidated file via
// pino.destination (in-process SonicBoom, no worker thread either).
const logStream: pino.DestinationStream = fileEnabled
    ? pino.multistream([
        { stream: prettyStream, level: DEFAULT_LOG_LEVEL as pino.Level },
        { stream: pino.destination({ dest: consolidatedLogFile!, mkdir: true }), level: DEFAULT_LOG_LEVEL as pino.Level },
    ])
    : prettyStream;

// Main server logger with local time formatting
export const logger = pino(baseOptions, logStream);

// Optional file-only logger for remote logs from CLI/mobile
export const fileConsolidatedLogger = fileEnabled
    ? pino(baseOptions, pino.destination({ dest: consolidatedLogFile!, mkdir: true }))
    : undefined;

// Dedicated file-only logger for web-diagnostics uploads (crash trails from
// happy-app web client). Always enabled — crash uploads are low frequency,
// and we want them captured even without the dangerous AI-debug flag.
//
// Writes to .logs/web-diagnostics-YYYY-MM-DD.log (one file per local day).
// Rotation happens lazily inside the destination's write() — a cheap date
// comparison per line, no setInterval (which would pin a timer ref and
// block process shutdown). On startup we prune files older than 14 days
// so disk use stays bounded.
//
// Why a hand-rolled rotation instead of pino-roll: pino transports run
// inside a worker thread that require()s targets at runtime by file path,
// which breaks inside `bun build --compile` single-file binaries — the
// same reason pretty-stream above is built as an in-process stream rather
// than via pino.transport().
const WEB_DIAG_LOGS_DIR = join(process.cwd(), '.logs');
const WEB_DIAG_FILE_PREFIX = 'web-diagnostics-';
const WEB_DIAG_FILE_SUFFIX = '.log';
const WEB_DIAG_RETENTION_DAYS = 14;

function webDiagDailyKey(date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function webDiagPathForKey(key: string): string {
    return join(WEB_DIAG_LOGS_DIR, `${WEB_DIAG_FILE_PREFIX}${key}${WEB_DIAG_FILE_SUFFIX}`);
}

function createWebDiagRotatingDestination(): pino.DestinationStream | undefined {
    try {
        mkdirSync(WEB_DIAG_LOGS_DIR, { recursive: true });
    } catch (error) {
        console.error('Failed to create logs directory for web-diagnostics:', error);
        return undefined;
    }

    let currentKey = webDiagDailyKey();
    let currentDest = pino.destination({ dest: webDiagPathForKey(currentKey), mkdir: true });

    function rotateIfNeeded() {
        const key = webDiagDailyKey();
        if (key === currentKey) return;
        // Hand off cleanly so the previous day's tail isn't truncated.
        try {
            (currentDest as { flushSync?: () => void }).flushSync?.();
            (currentDest as { end?: () => void }).end?.();
        } catch {
            // best-effort
        }
        currentKey = key;
        currentDest = pino.destination({ dest: webDiagPathForKey(currentKey), mkdir: true });
    }

    // pino accepts any { write(msg: string): void } as a DestinationStream.
    // We also expose flushSync/end so shutdown still drains the buffer.
    return {
        write(msg: string) {
            rotateIfNeeded();
            currentDest.write(msg);
        },
        flushSync() {
            (currentDest as { flushSync?: () => void }).flushSync?.();
        },
        end() {
            (currentDest as { end?: () => void }).end?.();
        },
    } as unknown as pino.DestinationStream;
}

async function pruneOldWebDiagLogs(): Promise<void> {
    try {
        const entries = await readdir(WEB_DIAG_LOGS_DIR);
        const cutoff = Date.now() - WEB_DIAG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        for (const name of entries) {
            if (!name.startsWith(WEB_DIAG_FILE_PREFIX) || !name.endsWith(WEB_DIAG_FILE_SUFFIX)) {
                continue;
            }
            const datePart = name.slice(WEB_DIAG_FILE_PREFIX.length, -WEB_DIAG_FILE_SUFFIX.length);
            // YYYY-MM-DD parses as UTC midnight; precise enough for a 14-day cutoff.
            const ts = Date.parse(datePart);
            if (!Number.isFinite(ts)) continue;
            if (ts < cutoff) {
                try {
                    await unlink(join(WEB_DIAG_LOGS_DIR, name));
                } catch {
                    // ignore — best-effort
                }
            }
        }
    } catch {
        // ignore — no .logs dir yet, or unreadable
    }
}

const webDiagDestination = createWebDiagRotatingDestination();
export const webDiagnosticsLogger = webDiagDestination
    ? pino(baseOptions, webDiagDestination)
    : undefined;

// Fire-and-forget prune on startup. Never throws.
void pruneOldWebDiagLogs();

function resolveLogLevel(src: any): pino.LevelWithSilent | null {
    if (!src || typeof src !== 'object' || Array.isArray(src)) {
        return null;
    }
    const level = src.level;
    if (typeof level !== 'string') {
        return null;
    }
    switch (level) {
        case 'trace':
        case 'debug':
        case 'info':
        case 'warn':
        case 'error':
        case 'fatal':
        case 'silent':
            return level;
        default:
            return null;
    }
}

function stripLevel(src: any): any {
    if (!src || typeof src !== 'object' || Array.isArray(src) || !('level' in src)) {
        return src;
    }
    const { level: _, ...rest } = src;
    return rest;
}

export function log(src: any, ...args: any[]) {
    const level = resolveLogLevel(src);
    if (level) {
        logger[level](stripLevel(src), ...args);
        return;
    }
    logger.info(src, ...args);
}

export function debug(src: any, ...args: any[]) {
    logger.debug(src, ...args);
}

export function warn(src: any, ...args: any[]) {
    logger.warn(src, ...args);
}
