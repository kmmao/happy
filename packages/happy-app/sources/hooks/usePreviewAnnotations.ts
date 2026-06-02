/**
 * Manages the list of active annotation pins for the current preview session.
 *
 * Bridges the injected annotation runtime's postMessage protocol to React state:
 *   - `addPin(comment, anchor)` → emit TRACK to iframe; store pin
 *   - Receive ANCHOR_UPDATE → reposition pin
 *   - `removePin(id)` → emit UNTRACK to iframe; remove pin
 */

import * as React from "react";
import type { AnnotationPin } from "@/components/preview/AnnotationPinsOverlay";

export interface AnchorRef {
    /** Selector string from the injected script (target.selector). */
    readonly selector: string;
    /** XPath from the injected script (target.xpath). */
    readonly xpath?: string;
}

export interface UsePreviewAnnotationsResult {
    readonly pins: readonly AnnotationPin[];
    /** Called by preview.tsx when user submits a comment with an anchor. */
    readonly addPin: (comment: string, anchor: AnchorRef) => string;
    readonly removePin: (id: string) => void;
    readonly clear: () => void;
    /**
     * Called by LivePreviewView when it receives ANCHOR_UPDATE postMessage.
     * Updates pin rects in-place. Pins not in the update keep their old rect.
     */
    readonly applyAnchorUpdates: (
        updates: Array<{
            id: string;
            rect?: { x: number; y: number; width: number; height: number };
            visible?: boolean;
            lost?: boolean;
        }>,
    ) => void;
    /**
     * Called by LivePreviewView right after a new pin is added or the iframe reloads.
     * Returns the list of TRACK messages to send to the iframe (id, selector, xpath).
     */
    readonly getPendingTracks: () => Array<{ id: string; selector: string; xpath?: string }>;
}

export function usePreviewAnnotations(_sessionId: string | undefined): UsePreviewAnnotationsResult {
    const [pins, setPins] = React.useState<AnnotationPin[]>([]);
    const anchorsRef = React.useRef<Map<string, AnchorRef>>(new Map());

    const addPin = React.useCallback((comment: string, anchor: AnchorRef): string => {
        const id = `cmt-${Math.random().toString(36).slice(2, 10)}`;
        anchorsRef.current.set(id, anchor);
        setPins((prev) => [
            ...prev,
            { id, comment, index: prev.length + 1, rect: null, lost: false },
        ]);
        return id;
    }, []);

    const removePin = React.useCallback((id: string) => {
        anchorsRef.current.delete(id);
        setPins((prev) =>
            prev
                .filter((p) => p.id !== id)
                // Re-index remaining
                .map((p, i) => ({ ...p, index: i + 1 })),
        );
    }, []);

    const clear = React.useCallback(() => {
        anchorsRef.current.clear();
        setPins([]);
    }, []);

    const applyAnchorUpdates = React.useCallback(
        (
            updates: Array<{
                id: string;
                rect?: { x: number; y: number; width: number; height: number };
                visible?: boolean;
                lost?: boolean;
            }>,
        ) => {
            setPins((prev) =>
                prev.map((p) => {
                    const u = updates.find((x) => x.id === p.id);
                    if (!u) return p;
                    if (u.lost) return { ...p, lost: true };
                    if (u.rect) return { ...p, rect: u.rect, lost: false };
                    return p;
                }),
            );
        },
        [],
    );

    const getPendingTracks = React.useCallback(() => {
        const out: Array<{ id: string; selector: string; xpath?: string }> = [];
        for (const [id, anchor] of anchorsRef.current) {
            out.push({ id, selector: anchor.selector, xpath: anchor.xpath });
        }
        return out;
    }, []);

    return React.useMemo(
        () => ({ pins, addPin, removePin, clear, applyAnchorUpdates, getPendingTracks }),
        [pins, addPin, removePin, clear, applyAnchorUpdates, getPendingTracks],
    );
}
