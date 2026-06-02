/**
 * Hook for live remote preview: manages WebView URL, viewport presets, zoom level,
 * and URL reachability probing.
 *
 * Re-uses portDetection for dev server discovery and previewUrl for Tailscale/tunnel
 * URL construction.
 */

import * as React from "react";
import { detectAllPorts, type DetectedPort } from "@/hooks/portDetection";
import { sessionBash } from "@/sync/ops";
import { useSession, useMachine } from "@/sync/storage";
import type { Machine } from "@/sync/storageTypes";

// ── Viewport presets ─────────────────────────────────────────────────────────

export interface ViewportPreset {
    readonly key: string;
    readonly label: string;
    readonly width: number;
    readonly height: number;
    readonly icon: "phone-portrait-outline" | "tablet-portrait-outline" | "desktop-outline";
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
    { key: "mobile", label: "Mobile", width: 375, height: 667, icon: "phone-portrait-outline" },
    { key: "tablet", label: "Tablet", width: 768, height: 1024, icon: "tablet-portrait-outline" },
    { key: "desktop", label: "Desktop", width: 1280, height: 800, icon: "desktop-outline" },
] as const;

export const DEFAULT_VIEWPORT = VIEWPORT_PRESETS[2]!; // desktop

// ── Zoom ─────────────────────────────────────────────────────────────────────

export const ZOOM_MIN = 25;
export const ZOOM_MAX = 150;
export const ZOOM_STEP = 25;
export const ZOOM_DEFAULT = 100;

// ── Types ────────────────────────────────────────────────────────────────────

export type PreviewMode = "live" | "screenshot";

export type LivePreviewStatus =
    | "idle"
    | "detecting"
    | "ready"
    | "loading"
    | "loaded"
    | "error"
    | "unreachable";

export interface LivePreviewState {
    readonly status: LivePreviewStatus;
    readonly url: string;
    readonly ports: readonly DetectedPort[];
    readonly viewport: ViewportPreset;
    readonly zoom: number;
    readonly error?: string;
    readonly orientation: "portrait" | "landscape";
    readonly handMode: boolean;
    readonly panOffset: { x: number; y: number };
}

export interface UseRemotePreviewResult {
    readonly state: LivePreviewState;
    readonly mode: PreviewMode;
    readonly setMode: (mode: PreviewMode) => void;
    readonly setUrl: (url: string) => void;
    readonly setViewport: (preset: ViewportPreset) => void;
    readonly setZoom: (zoom: number) => void;
    readonly zoomIn: () => void;
    readonly zoomOut: () => void;
    readonly zoomFit: () => void;
    readonly refresh: () => void;
    readonly selectPort: (port: DetectedPort) => void;
    readonly onWebViewLoad: () => void;
    readonly onWebViewError: (error: string) => void;
    readonly detectPorts: () => void;
    readonly toggleOrientation: () => void;
    readonly setHandMode: (enabled: boolean) => void;
    readonly setPanOffset: (offset: { x: number; y: number }) => void;
    readonly resetPan: () => void;
}

/**
 * Build a reachable URL for a given port using the machine's Tailscale IP
 * or tunnel entries.
 */
function buildReachableUrl(port: number, machine: Machine | null): string {
    // 1. Check Caddy/tunnel entries for a public URL
    const tunnels = (machine?.daemonState as any)?.tunnels;
    if (tunnels?.providers && Array.isArray(tunnels.providers)) {
        for (const provider of tunnels.providers) {
            if (provider.status !== "available" || !Array.isArray(provider.entries)) continue;
            for (const entry of provider.entries) {
                if (entry.localPort === port && entry.publicUrl) {
                    return entry.publicUrl;
                }
            }
        }
    }

    // 2. Check Tailscale Serve entries
    const ts = (machine?.daemonState as any)?.tailscale;
    if (ts?.serves && Array.isArray(ts.serves)) {
        for (const serve of ts.serves) {
            if (serve.port === port && ts.hostname) {
                return `https://${ts.hostname}${serve.path || "/"}`;
            }
        }
    }

    // 3. Tailscale direct IP
    if (ts?.status === "connected" && ts.ipv4) {
        return `http://${ts.ipv4}:${port}`;
    }

    // 4. Fallback to localhost (only works if same machine or tunneled)
    return `http://localhost:${port}`;
}

export function useRemotePreview(sessionId: string | undefined): UseRemotePreviewResult {
    const session = useSession(sessionId ?? "");
    const machineId = session?.metadata?.machineId ?? "";
    const machine = useMachine(machineId);

    const [mode, setMode] = React.useState<PreviewMode>("live");
    const [state, setState] = React.useState<LivePreviewState>({
        status: "idle",
        url: "",
        ports: [],
        viewport: DEFAULT_VIEWPORT,
        zoom: ZOOM_DEFAULT,
        orientation: "portrait",
        handMode: false,
        panOffset: { x: 0, y: 0 },
    });

    const stateRef = React.useRef(state);
    stateRef.current = state;

    const detectingRef = React.useRef(false);

    // ── Port detection ───────────────────────────────────────────────────────

    const detectPorts = React.useCallback(async () => {
        if (!sessionId || detectingRef.current) return;
        detectingRef.current = true;

        setState((prev) => ({ ...prev, status: "detecting" }));

        try {
            const bash = (req: { command: string; timeout?: number }) =>
                sessionBash(sessionId, req);

            const ports = await detectAllPorts(bash, { filterByCwd: true });
            const webPorts = ports.filter((p) => p.isWeb);

            // Auto-select first common dev port, or first web port
            const autoPort = webPorts.find((p) => p.isCommonDevPort) ?? webPorts[0];
            const url = autoPort
                ? buildReachableUrl(autoPort.port, machine ?? null)
                : "";

            setState((prev) => ({
                ...prev,
                status: url ? "ready" : "idle",
                url: prev.url || url,
                ports: webPorts,
            }));
        } catch {
            setState((prev) => ({
                ...prev,
                status: "error",
                error: "Port detection failed",
            }));
        } finally {
            detectingRef.current = false;
        }
    }, [sessionId, machine]);

    // Auto-detect on mount
    React.useEffect(() => {
        if (sessionId && mode === "live") {
            detectPorts();
        }
    }, [sessionId, mode, detectPorts]);

    // ── URL management ───────────────────────────────────────────────────────

    const setUrl = React.useCallback((url: string) => {
        setState((prev) => ({
            ...prev,
            url,
            status: url ? "ready" : prev.status,
        }));
    }, []);

    const selectPort = React.useCallback((port: DetectedPort) => {
        const url = buildReachableUrl(port.port, machine ?? null);
        setState((prev) => ({
            ...prev,
            url,
            status: "loading",
        }));
    }, [machine]);

    // ── Viewport ─────────────────────────────────────────────────────────────

    const setViewport = React.useCallback((preset: ViewportPreset) => {
        setState((prev) => ({ ...prev, viewport: preset }));
    }, []);

    // ── Zoom ─────────────────────────────────────────────────────────────────

    const setZoom = React.useCallback((zoom: number) => {
        setState((prev) => ({
            ...prev,
            zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom)),
        }));
    }, []);

    const zoomIn = React.useCallback(() => {
        setState((prev) => ({
            ...prev,
            zoom: Math.min(ZOOM_MAX, prev.zoom + ZOOM_STEP),
        }));
    }, []);

    const zoomOut = React.useCallback(() => {
        setState((prev) => ({
            ...prev,
            zoom: Math.max(ZOOM_MIN, prev.zoom - ZOOM_STEP),
        }));
    }, []);

    const zoomFit = React.useCallback(() => {
        setState((prev) => ({ ...prev, zoom: ZOOM_DEFAULT }));
    }, []);

    // ── WebView lifecycle ────────────────────────────────────────────────────

    const refresh = React.useCallback(() => {
        setState((prev) => ({
            ...prev,
            status: "loading",
            // Force WebView reload by toggling URL briefly — handled by component
        }));
        // Small delay then set back to ready to trigger remount
        setTimeout(() => {
            setState((prev) => ({ ...prev, status: "ready" }));
        }, 100);
    }, []);

    const onWebViewLoad = React.useCallback(() => {
        setState((prev) => ({
            ...prev,
            status: "loaded",
            error: undefined,
        }));
    }, []);

    const onWebViewError = React.useCallback((error: string) => {
        setState((prev) => ({
            ...prev,
            status: "error",
            error,
        }));
    }, []);

    // ── Orientation, hand mode, pan ────────────────────────────────────────────

    const toggleOrientation = React.useCallback(() => {
        setState((prev) => ({
            ...prev,
            orientation: prev.orientation === "portrait" ? "landscape" : "portrait",
        }));
    }, []);

    const setHandMode = React.useCallback((enabled: boolean) => {
        setState((prev) => ({ ...prev, handMode: enabled }));
    }, []);

    const setPanOffset = React.useCallback((offset: { x: number; y: number }) => {
        setState((prev) => ({ ...prev, panOffset: offset }));
    }, []);

    const resetPan = React.useCallback(() => {
        setState((prev) => ({ ...prev, panOffset: { x: 0, y: 0 } }));
    }, []);

    // ── Auto-refresh ports every 15s ─────────────────────────────────────────

    React.useEffect(() => {
        if (!sessionId || mode !== "live") return;
        const interval = setInterval(() => {
            if (!detectingRef.current) {
                // Silent port refresh — update ports list without changing status
                const bash = (req: { command: string; timeout?: number }) =>
                    sessionBash(sessionId, req);

                detectAllPorts(bash, { filterByCwd: true })
                    .then((ports) => {
                        const webPorts = ports.filter((p) => p.isWeb);
                        setState((prev) => ({ ...prev, ports: webPorts }));
                    })
                    .catch(() => {});
            }
        }, 15000);
        return () => clearInterval(interval);
    }, [sessionId, mode]);

    return {
        state,
        mode,
        setMode,
        setUrl,
        setViewport,
        setZoom,
        zoomIn,
        zoomOut,
        zoomFit,
        refresh,
        selectPort,
        onWebViewLoad,
        onWebViewError,
        detectPorts,
        toggleOrientation,
        setHandMode,
        setPanOffset,
        resetPan,
    };
}
