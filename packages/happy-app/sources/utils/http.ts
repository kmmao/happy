import { NonRetryableError } from '@/utils/time';

/**
 * Throw an appropriate error if the response is not ok.
 * - 4xx errors → NonRetryableError (will NOT be retried by backoff)
 * - 5xx errors → regular Error (will be retried by backoff)
 */
export function throwIfNotOk(response: Response, message: string): void {
    if (response.ok) return;

    const ErrorClass = response.status >= 400 && response.status < 500
        ? NonRetryableError
        : Error;
    throw new ErrorClass(`${message}: ${response.status}`);
}
