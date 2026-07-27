/**
 * Client for an OpenAI Realtime compatible "calls" gateway.
 *
 * Targets sub2api's Live gateway (`POST /v1/live`), which exchanges a WebRTC
 * SDP offer for an answer and proxies the session to an upstream ChatGPT
 * account. The gateway forwards the `session` object untouched.
 */

export interface CreateLiveCallOptions {
    /** Gateway base URL, with or without a trailing `/v1`. */
    baseUrl: string;
    /** API key sent as a Bearer token. The gateway rejects keys in the query string. */
    apiKey: string;
    /** Local SDP offer. */
    sdp: string;
    /** Session configuration forwarded verbatim to the upstream. */
    session: Record<string, unknown>;
    signal?: AbortSignal;
}

export interface LiveCallResult {
    /** Remote SDP answer. */
    answerSdp: string;
    /**
     * Call id parsed from the `Location` response header, or null when the
     * header is unreadable. Browsers cannot read it cross-origin unless the
     * gateway lists `Location` in `Access-Control-Expose-Headers`; the WebRTC
     * data channel carries every event we need, so this is informational only.
     */
    callId: string | null;
}

/** Resolve `${base}/v1/live` while tolerating a base that already ends in `/v1`. */
export function resolveLiveEndpoint(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    if (!trimmed) {
        throw new Error('Realtime gateway URL is not configured');
    }
    return trimmed.endsWith('/v1') ? `${trimmed}/live` : `${trimmed}/v1/live`;
}

function parseCallId(location: string | null): string | null {
    if (!location) return null;
    const path = location.split('?')[0].replace(/\/+$/, '');
    const callId = path.slice(path.lastIndexOf('/') + 1);
    return callId || null;
}

async function readErrorMessage(response: Response): Promise<string> {
    const body = await response.text().catch(() => '');
    if (!body) return `${response.status}`;
    try {
        const json = JSON.parse(body);
        const message = json?.error?.message ?? json?.message;
        if (typeof message === 'string' && message) {
            return `${response.status} ${message}`;
        }
    } catch {
        // Non-JSON error body — fall through to the raw text.
    }
    return `${response.status} ${body.slice(0, 200)}`;
}

export async function createLiveCall(options: CreateLiveCallOptions): Promise<LiveCallResult> {
    const response = await fetch(resolveLiveEndpoint(options.baseUrl), {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/sdp',
        },
        body: JSON.stringify({
            sdp: options.sdp,
            session: options.session,
        }),
        signal: options.signal,
    });

    if (!response.ok) {
        throw new Error(`Live call failed: ${await readErrorMessage(response)}`);
    }

    const answerSdp = await response.text();
    if (!answerSdp.trim()) {
        throw new Error('Live call failed: gateway returned an empty SDP answer');
    }

    return {
        answerSdp,
        callId: parseCallId(response.headers.get('Location')),
    };
}
