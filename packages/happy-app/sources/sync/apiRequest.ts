import type { z } from 'zod';
import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { throwIfNotOk } from '@/utils/http';
import { getServerUrl } from './serverConfig';

/**
 * Unified request seam for the server HTTP API.
 *
 * Every endpoint wrapper used to repeat the same machinery inline: resolve the
 * base URL, attach the bearer token, JSON-encode the body, wrap the call in
 * `backoff`, and run `throwIfNotOk` on the response. Concentrating that here
 * gives one place to change the auth scheme, retry policy, base URL, or
 * error-to-exception mapping — and one surface to test.
 *
 * Endpoints with genuinely per-endpoint response logic (e.g. treating 404 as
 * `null` or parsing a 409 body) keep handling the raw `Response` themselves;
 * this seam covers the common "throw on !ok, parse JSON on ok" path.
 */

type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ApiRequestOptions {
    /** HTTP method. Defaults to `GET`. */
    method?: ApiMethod;
    /** Request payload, JSON-encoded when present (adds `Content-Type`). */
    body?: unknown;
    /** Query parameters; `undefined`/`null` values are skipped. */
    query?: Record<string, string | number | boolean | undefined | null>;
    /** Extra headers merged over the defaults. */
    headers?: Record<string, string>;
    /** Message prefix passed to `throwIfNotOk` (default `'Request failed'`). */
    errorMessage?: string;
    /** Disable exponential-backoff retry (default: enabled). */
    retry?: boolean;
}

function buildUrl(path: string, query?: ApiRequestOptions['query']): string {
    const base = path.startsWith('http') ? path : `${getServerUrl()}${path}`;
    if (!query) {
        return base;
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
            params.append(key, String(value));
        }
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
}

function buildHeaders(
    credentials: AuthCredentials,
    hasBody: boolean,
    extra?: Record<string, string>,
): Record<string, string> {
    const headers: Record<string, string> = {
        Authorization: `Bearer ${credentials.token}`,
    };
    if (hasBody) {
        headers['Content-Type'] = 'application/json';
    }
    return extra ? { ...headers, ...extra } : headers;
}

async function send(
    credentials: AuthCredentials,
    path: string,
    options: ApiRequestOptions,
): Promise<Response> {
    const hasBody = options.body !== undefined;
    const init: RequestInit = {
        method: options.method ?? 'GET',
        headers: buildHeaders(credentials, hasBody, options.headers),
    };
    if (hasBody) {
        init.body = JSON.stringify(options.body);
    }
    const response = await fetch(buildUrl(path, options.query), init);
    throwIfNotOk(response, options.errorMessage ?? 'Request failed');
    return response;
}

/** Perform a request and parse the JSON response as `T`. */
export async function apiRequest<T>(
    credentials: AuthCredentials,
    path: string,
    options: ApiRequestOptions = {},
): Promise<T> {
    const run = async () => {
        const response = await send(credentials, path, options);
        return (await response.json()) as T;
    };
    return options.retry === false ? await run() : await backoff(run);
}

/**
 * Perform a request and validate the JSON response against `schema`, returning
 * the parsed value or throwing a descriptive error.
 *
 * This is the runtime-validated peer of {@link apiRequest} (which casts the JSON
 * to `T` unchecked). It owns the "raw response → validated typed value, or throw"
 * invariant that endpoint wrappers otherwise re-implement inline as
 * `schema.safeParse(json)` + `throw`. Prefer this over `apiRequest<T>` whenever a
 * response schema exists; the error names the endpoint path and the first Zod
 * issue.
 */
export async function apiRequestParsed<T>(
    credentials: AuthCredentials,
    path: string,
    schema: z.ZodType<T>,
    options: ApiRequestOptions = {},
): Promise<T> {
    const json = await apiRequest<unknown>(credentials, path, options);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
        throw new Error(`Invalid response from ${path}: ${parsed.error.issues[0]?.message}`);
    }
    return parsed.data;
}

/** Perform a request that returns no body (or whose body is ignored). */
export async function apiRequestVoid(
    credentials: AuthCredentials,
    path: string,
    options: ApiRequestOptions = {},
): Promise<void> {
    const run = async () => {
        await send(credentials, path, options);
    };
    if (options.retry === false) {
        await run();
    } else {
        await backoff(run);
    }
}
