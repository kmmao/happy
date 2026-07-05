import * as React from "react";

/**
 * The "latest request wins" stale-response guard.
 *
 * Every hook that fires an async request whose inputs can change mid-flight
 * (search-as-you-type, session/project re-key, manual refresh) needs the same
 * three moves: stamp each request with a monotonic token, discard a response
 * whose token is no longer the latest, and bump the token to invalidate any
 * in-flight request on reset/unmount. This owns that guard so those three moves
 * stop being re-implemented per hook (ADR-0068).
 */
export interface RequestGuard {
    /** Start a new request; it becomes the latest and its token is returned. */
    begin(): number;
    /** Is `token` still the latest request (i.e. not superseded)? */
    isCurrent(token: number): boolean;
    /** Invalidate any in-flight request WITHOUT starting a new one. */
    invalidate(): void;
}

/**
 * Pure, React-free guard — a monotonic counter behind the {@link RequestGuard}
 * interface. Unit-testable without a renderer.
 */
export function createRequestGuard(): RequestGuard {
    let latest = 0;
    return {
        begin: () => {
            latest += 1;
            return latest;
        },
        isCurrent: (token) => token === latest,
        invalidate: () => {
            latest += 1;
        },
    };
}

/**
 * Hook wrapper: a single stable {@link RequestGuard} for the component's lifetime.
 */
export function useLatestRequest(): RequestGuard {
    const ref = React.useRef<RequestGuard | null>(null);
    if (ref.current === null) {
        ref.current = createRequestGuard();
    }
    return ref.current;
}
