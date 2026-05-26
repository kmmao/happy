import pino from 'pino';
import pretty from 'pino-pretty';
import { mkdirSync } from 'fs';
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
