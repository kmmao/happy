/**
 * Wraps a promise with a timeout. If the promise does not resolve within
 * the given milliseconds, the returned promise rejects with a TimeoutError.
 *
 * The underlying promise is NOT cancelled — only the race is abandoned.
 * If you need cancellation, pass an AbortSignal to the underlying operation.
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`Timeout: ${label} exceeded ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
