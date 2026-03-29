import { open, stat } from "fs/promises";
import { watch } from "fs";
import { logger } from "@/ui/logger";

const DEBOUNCE_MS = 200;
const MAX_CHUNK_BYTES = 8 * 1024; // 8KB per push
const MIN_PUSH_INTERVAL_MS = 200; // max ~5 pushes/sec

export type TaskLogChunk = {
  readonly taskId: string;
  readonly outputFile: string;
  readonly chunk: string;
  readonly offset: number;
};

type WatcherEntry = {
  readonly taskId: string;
  readonly outputFile: string;
  offset: number;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  lastPushTime: number;
  destroy: () => void;
};

type ChunkEmitter = (chunk: TaskLogChunk) => void;

const watchers = new Map<string, WatcherEntry>();

async function readIncrement(entry: WatcherEntry, emit: ChunkEmitter): Promise<void> {
  try {
    const fileStat = await stat(entry.outputFile);
    if (fileStat.size <= entry.offset) return;

    const bytesToRead = Math.min(fileStat.size - entry.offset, MAX_CHUNK_BYTES);
    const fd = await open(entry.outputFile, "r");
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await fd.read(buffer, 0, bytesToRead, entry.offset);
      if (bytesRead > 0) {
        const chunkOffset = entry.offset;
        entry.offset += bytesRead;

        emit({
          taskId: entry.taskId,
          outputFile: entry.outputFile,
          chunk: buffer.subarray(0, bytesRead).toString("utf-8"),
          offset: chunkOffset,
        });
        entry.lastPushTime = Date.now();

        // If there's still more data, schedule another read
        if (entry.offset < fileStat.size) {
          scheduleRead(entry, emit);
        }
      }
    } finally {
      await fd.close();
    }
  } catch (e: any) {
    if (e.code === "ENOENT") {
      // File was deleted — stop watching
      stopWatching(entry.taskId);
      return;
    }
    logger.debug(`[TASK_LOG] Read error for ${entry.taskId}: ${e.message}`);
  }
}

function scheduleRead(entry: WatcherEntry, emit: ChunkEmitter): void {
  if (entry.debounceTimer !== null) return; // Already scheduled

  const elapsed = Date.now() - entry.lastPushTime;
  const waitMs = Math.max(DEBOUNCE_MS, MIN_PUSH_INTERVAL_MS - elapsed);

  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null;
    void readIncrement(entry, emit);
  }, waitMs);
}

export function startWatching(taskId: string, outputFile: string, emit: ChunkEmitter): void {
  if (watchers.has(taskId)) {
    logger.debug(`[TASK_LOG] Already watching ${taskId}`);
    return;
  }

  logger.debug(`[TASK_LOG] Start watching ${taskId}: ${outputFile}`);

  const entry: WatcherEntry = {
    taskId,
    outputFile,
    offset: 0,
    debounceTimer: null,
    lastPushTime: 0,
    destroy: () => {},
  };

  try {
    const watcher = watch(outputFile, () => {
      scheduleRead(entry, emit);
    });

    watcher.on("error", (err) => {
      logger.debug(`[TASK_LOG] Watch error for ${taskId}: ${err.message}`);
    });

    entry.destroy = () => {
      watcher.close();
      if (entry.debounceTimer !== null) {
        clearTimeout(entry.debounceTimer);
        entry.debounceTimer = null;
      }
    };

    watchers.set(taskId, entry);

    // Read any existing content immediately
    void readIncrement(entry, emit);
  } catch (e: any) {
    logger.debug(`[TASK_LOG] Failed to start watching ${taskId}: ${e.message}`);
  }
}

export function stopWatching(taskId: string): void {
  const entry = watchers.get(taskId);
  if (!entry) return;

  logger.debug(`[TASK_LOG] Stop watching ${taskId}`);
  entry.destroy();
  watchers.delete(taskId);
}

export function stopAll(): void {
  for (const [taskId] of watchers) {
    stopWatching(taskId);
  }
}

export function isWatching(taskId: string): boolean {
  return watchers.has(taskId);
}
