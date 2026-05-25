/**
 * Web-only memory watchdog (diagnostics).
 *
 * The web client runs inside a memory-limited Chrome renderer process. Online
 * sessions are never LRU-evicted (see storage.ts) and their full message arrays
 * plus reducer Maps accumulate unbounded, so a long-lived tab can creep toward
 * Chrome's per-tab ceiling and get killed — the "Aw, Snap!" page, error code 5
 * (SBOX_FATAL_MEMORY_EXCEEDED). When the renderer dies the in-memory `log`
 * buffer dies with it, so this watchdog ALSO persists a compact ring buffer to
 * localStorage. After a crash + reload the previous trail is promoted to a
 * dedicated key and surfaced into the dev logs page so the run-up to the crash
 * can be inspected (was it thousands of normal messages, a few giant tool
 * results, or a pure time-based leak?).
 *
 * Sizes are a char-based estimate (UTF-16 length), not exact bytes — good enough
 * as a relative indicator of which session / message dominates the heap.
 *
 * No-op on native and on browsers without `performance.memory` (Chromium only).
 */
import { Platform } from "react-native";
import { log } from "@/log";
import { storage } from "@/sync/storage";

const SAMPLE_INTERVAL_MS = 15_000;
const FIRST_SAMPLE_DELAY_MS = 3_000;
const RING_CAPACITY = 80; // ~20 min of history at 15s
const HEAVY_RATIO = 0.6; // run the per-message content pass once heap climbs past this
const HEAVY_EVERY_N = 20; // ...or once every ~5 min as a baseline data point
const MESSAGE_SCAN_CAP = 20_000; // bound the content pass on pathological sessions
const SIZE_NODE_BUDGET = 2_000; // bound recursion per message (protects against one giant tool result)

const WARN_RATIO = 0.7;
const ERROR_RATIO = 0.85;

const RING_KEY = "happy:memwatch:v1";
const LAST_KEY = "happy:memwatch:last"; // previous session's trail (likely the crashed one)

interface Sample {
  t: number; // epoch ms
  used: number; // usedJSHeapSize MB
  limit: number; // jsHeapSizeLimit MB
  ratio: number; // used/limit, 2 decimals
  sessions: number; // sessions holding messages
  msgs: number; // total messages across all sessions
  topId: string; // session id (truncated) with the most messages
  topMsgs: number; // its message count
  contentMB?: number; // total estimated content size (heavy pass only)
  maxMsgKB?: number; // largest single message (heavy pass only)
  maxMsgKind?: string; // its kind (heavy pass only)
}

type PerfMemory = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

let started = false;
let tickIndex = 0;
let prevRatio = 0;

function getMemory(): PerfMemory | null {
  if (typeof performance === "undefined") return null;
  const mem = (performance as unknown as { memory?: PerfMemory }).memory;
  if (!mem || typeof mem.usedJSHeapSize !== "number") return null;
  return mem;
}

// Allocation-free size estimate: sums string lengths + small constants, bounded
// by a node budget so deeply nested / huge structures can't make sampling slow.
function roughSize(value: unknown, budget: { n: number }): number {
  if (budget.n <= 0) return 0;
  budget.n--;
  if (value == null) return 0;
  const t = typeof value;
  if (t === "string") return (value as string).length;
  if (t === "number") return 8;
  if (t === "boolean") return 4;
  if (t !== "object") return 0;
  let total = 0;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (budget.n <= 0) break;
      total += roughSize(value[i], budget);
    }
    return total;
  }
  for (const key in value as Record<string, unknown>) {
    if (budget.n <= 0) break;
    total += key.length + roughSize((value as Record<string, unknown>)[key], budget);
  }
  return total;
}

function takeSample(): Sample | null {
  const mem = getMemory();
  if (!mem) return null;

  const usedMB = mem.usedJSHeapSize / 1048576;
  const limitMB = mem.jsHeapSizeLimit / 1048576;
  const ratio = limitMB > 0 ? usedMB / limitMB : 0;

  const sessionMessages = storage.getState().sessionMessages;
  let sessions = 0;
  let totalMsgs = 0;
  let topId = "";
  let topMsgs = 0;
  for (const id in sessionMessages) {
    const count = sessionMessages[id]?.messages?.length ?? 0;
    if (count === 0) continue;
    sessions++;
    totalMsgs += count;
    if (count > topMsgs) {
      topMsgs = count;
      topId = id;
    }
  }

  const sample: Sample = {
    t: Date.now(),
    used: Math.round(usedMB),
    limit: Math.round(limitMB),
    ratio: Math.round(ratio * 100) / 100,
    sessions,
    msgs: totalMsgs,
    topId: topId.slice(0, 8),
    topMsgs,
  };

  // The per-message content breakdown is O(total messages) — only worth paying
  // for when memory is actually climbing, plus a rare baseline sample.
  const heavy = totalMsgs > 0 && (ratio >= HEAVY_RATIO || tickIndex % HEAVY_EVERY_N === 0);
  if (heavy) {
    let contentChars = 0;
    let maxChars = 0;
    let maxKind = "";
    let scanned = 0;
    outer: for (const id in sessionMessages) {
      const arr = sessionMessages[id]?.messages;
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        if (scanned >= MESSAGE_SCAN_CAP) break outer;
        scanned++;
        const size = roughSize(arr[i], { n: SIZE_NODE_BUDGET });
        contentChars += size;
        if (size > maxChars) {
          maxChars = size;
          maxKind = (arr[i] as { kind?: string })?.kind ?? "?";
        }
      }
    }
    sample.contentMB = Math.round((contentChars / 1048576) * 10) / 10;
    sample.maxMsgKB = Math.round(maxChars / 1024);
    sample.maxMsgKind = maxKind;
  }

  return sample;
}

function readRing(key: string): Sample[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRing(key: string, samples: Sample[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(samples));
  } catch {
    // quota exceeded or storage disabled — diagnostics are best-effort
  }
}

function formatSample(s: Sample): string {
  const time = new Date(s.t).toLocaleTimeString();
  let line =
    `[memwatch] ${time} heap=${s.used}/${s.limit}MB (${Math.round(s.ratio * 100)}%)` +
    ` sessions=${s.sessions} msgs=${s.msgs} top=${s.topId}:${s.topMsgs}`;
  if (s.contentMB != null) {
    line += ` content≈${s.contentMB}MB maxMsg≈${s.maxMsgKB}KB(${s.maxMsgKind})`;
  }
  return line;
}

function surfacePreviousTrail(samples: Sample[]): void {
  const peak = samples.reduce((m, s) => Math.max(m, s.ratio), 0);
  const last = samples[samples.length - 1];
  log.warn(
    `[memwatch] ===== previous session trail (${samples.length} samples, peak heap ${Math.round(peak * 100)}%) =====`,
  );
  // The tail is the run-up to the previous shutdown — most likely the crash.
  for (const s of samples.slice(-12)) {
    log.warn(formatSample(s));
  }
  log.warn(
    `[memwatch] ===== end previous trail (last sample ${new Date(last.t).toLocaleTimeString()}) =====`,
  );
}

function tick(): void {
  const sample = takeSample();
  tickIndex++;
  if (!sample) return;

  const ring = readRing(RING_KEY);
  ring.push(sample);
  if (ring.length > RING_CAPACITY) {
    ring.splice(0, ring.length - RING_CAPACITY);
  }
  writeRing(RING_KEY, ring);

  // Surface to the in-memory dev log selectively so we don't flood its 5k buffer.
  const line = formatSample(sample);
  if (sample.ratio >= ERROR_RATIO) {
    if (prevRatio < ERROR_RATIO) {
      log.error(`[memwatch] heap critical (${Math.round(sample.ratio * 100)}%) — tab may be killed soon`);
    }
    log.error(line);
  } else if (sample.ratio >= WARN_RATIO) {
    if (prevRatio < WARN_RATIO) {
      log.warn(`[memwatch] heap high (${Math.round(sample.ratio * 100)}%)`);
    }
    log.warn(line);
  } else if (sample.ratio >= HEAVY_RATIO || tickIndex % HEAVY_EVERY_N === 1) {
    log.log(line);
  }
  prevRatio = sample.ratio;
}

/**
 * Dump both the current and previous run trails into the dev log and return them
 * as a string. Exposed on `window.__happyMemWatch.dump()` for console use.
 */
export function dumpMemoryWatchTrail(): string {
  if (Platform.OS !== "web" || typeof window === "undefined") return "";
  const cur = readRing(RING_KEY);
  const last = readRing(LAST_KEY);
  const lines: string[] = [`[memwatch] current run: ${cur.length} samples`];
  for (const s of cur) lines.push(formatSample(s));
  lines.push(`[memwatch] previous run: ${last.length} samples`);
  for (const s of last) lines.push(formatSample(s));
  for (const l of lines) log.log(l);
  return lines.join("\n");
}

/**
 * Start sampling. Safe to call multiple times; only the first call takes effect.
 * No-op off web and on browsers without `performance.memory`.
 */
export function startMemoryWatchdog(): void {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  if (started) return;
  if (!getMemory()) return; // non-Chromium: nothing to sample
  started = true;

  // Promote the previous session's trail (likely the crashed one) so it survives
  // into this run and is visible on the dev logs page, then start fresh.
  try {
    const prev = readRing(RING_KEY);
    if (prev.length > 0) {
      writeRing(LAST_KEY, prev);
      surfacePreviousTrail(prev);
    }
  } catch {
    // ignore
  }
  writeRing(RING_KEY, []);

  setInterval(tick, SAMPLE_INTERVAL_MS);
  setTimeout(tick, FIRST_SAMPLE_DELAY_MS);

  (window as unknown as { __happyMemWatch?: unknown }).__happyMemWatch = {
    dump: dumpMemoryWatchTrail,
    sample: () => {
      const s = takeSample();
      if (s) log.log(formatSample(s));
      return s;
    },
  };
}
