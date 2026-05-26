import { shouldReconnect as defaultShouldReconnect } from "./shouldReconnect";

/**
 * Self-managed WebSocket reconnection loop.
 *
 * Replaces socket.io's built-in auto-reconnect (which latches onto Power-Nap
 * WiFi blips and creates server-side zombie sessions) with a gated loop:
 *
 *  - `schedule()` — called on `disconnect` / `connect_error`. Starts polling.
 *  - while the gate (`shouldReconnect`) is unmet, re-poll every `pollIntervalMs`;
 *  - once met, wait `reconnectDelayMs` then fire a single `connect()` attempt and
 *    let the socket's own `connect` / `connect_error` outcome drive the next step;
 *  - `cancel()` — called on a successful `connect`. Stops the loop but stays
 *    re-armable for the next disconnect;
 *  - `shutdown()` — called on client close. Permanently stops the loop.
 *
 * Lid-reopen therefore recovers within a single poll cycle, and the loop never
 * runs more than one cycle concurrently.
 */

export interface SmartReconnectOptions {
  /** Fire a single socket connect attempt. */
  connect: () => void;
  /** Gate deciding whether to reconnect now. Injectable for tests. */
  shouldReconnect?: () => Promise<boolean>;
  /** Poll interval while the gate is unmet (default 5000ms). */
  pollIntervalMs?: number;
  /** Delay before reconnecting once the gate is met (default 1000ms). */
  reconnectDelayMs?: number;
  /** Optional debug logger. */
  log?: (message: string) => void;
}

export interface SmartReconnectHandle {
  /** Begin the reconnect loop after a disconnect / connect_error. */
  schedule: () => void;
  /** Stop the loop after a successful connect (re-armable). */
  cancel: () => void;
  /** Permanently stop the loop on shutdown. */
  shutdown: () => void;
}

export function createSmartReconnect(
  options: SmartReconnectOptions,
): SmartReconnectHandle {
  const gate = options.shouldReconnect ?? defaultShouldReconnect;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const reconnectDelayMs = options.reconnectDelayMs ?? 1000;
  const log = options.log ?? (() => {});

  let timer: ReturnType<typeof setTimeout> | null = null;
  // `active` guards against running more than one cycle at a time; `stopped`
  // makes shutdown permanent.
  let active = false;
  let stopped = false;

  const stop = () => {
    active = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const evaluate = async () => {
    timer = null;
    if (!active || stopped) {
      return;
    }
    let ok = false;
    try {
      ok = await gate();
    } catch (error) {
      log(
        `reconnect gate failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // cancel()/shutdown() may have run during the awaited probe.
    if (!active || stopped) {
      return;
    }
    if (ok) {
      log("conditions met — reconnecting shortly");
      timer = setTimeout(() => {
        timer = null;
        // The cycle ends here: the socket's connect / connect_error outcome
        // drives whether we cancel() or schedule() again.
        active = false;
        if (!stopped) {
          options.connect();
        }
      }, reconnectDelayMs);
    } else {
      log("conditions not met — polling");
      timer = setTimeout(() => {
        void evaluate();
      }, pollIntervalMs);
    }
  };

  return {
    schedule() {
      if (stopped || active) {
        return;
      }
      active = true;
      timer = setTimeout(() => {
        void evaluate();
      }, 0);
    },
    cancel() {
      stop();
    },
    shutdown() {
      stopped = true;
      stop();
    },
  };
}
