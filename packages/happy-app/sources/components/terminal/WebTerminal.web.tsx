/**
 * WebTerminal — xterm.js-based web terminal emulator.
 * Connects to a CLI daemon's PTY via Socket.IO relay.
 *
 * Each Claude session owns one persistent PTY (keyed by sessionId).
 * Switching tabs detaches the listener but keeps the process alive.
 * Re-opening replays buffered output and resumes the session.
 *
 * Web-only component (uses DOM APIs).
 */
import React, { useRef, useEffect, useCallback, useState } from "react";
import { View, Pressable } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { Asset } from "expo-asset";
import { apiSocket } from "@/sync/apiSocket";
import {
    machineTerminalSpawn,
    machineTerminalClose,
    machineTerminalResize,
    machineTerminalInput,
    machineUpgradeCli,
    waitForMachineCliVersion,
} from "@/sync/ops";
import { useMachine } from "@/sync/storage";
import { resolveCliSelfUpgradeSupport } from "@/hooks/cliSelfUpgradeSupport";
import { useCliVersionCheck } from "@/hooks/useCliVersionCheck";
import { attemptChunkReload, isChunkLoadError } from "@/utils/chunkReloadGuard";
import { loadXtermSnapshot, saveXtermSnapshot } from "@/utils/xtermSnapshotCache";
import { t } from "@/text";

// Debounce window for persisting xterm state to localStorage after new bytes
// land. Long enough that streaming a paragraph of Claude output only writes
// once; short enough that a browser refresh moments after content stops
// reliably captures it. See xtermSnapshotCache module comment for the full
// rationale — the persistence layer exists so refresh doesn't fall back to
// the daemon's 256 KB rolling replay buffer (which drops history at
// clear-screen / alt-screen sync points).
const XTERM_SNAPSHOT_SAVE_DEBOUNCE_MS = 1500;

interface WebTerminalProps {
    machineId: string;
    cwd?: string;
    sessionId?: string;   // Claude session ID — used to persist PTY across tab switches
    terminalId?: string;  // specific PTY ID to reattach (set by multi-terminal parent)
    isActive?: boolean;   // triggers fitAddon.fit() when tab becomes visible
    showInternalCloseButton?: boolean; // default true; set false when parent manages close button
    onClose?: () => void;
}

type TerminalState = "connecting" | "connected" | "disconnected" | "error";

function WebTerminalComponent({ machineId, cwd, sessionId, terminalId: terminalIdProp, isActive, showInternalCloseButton = true, onClose }: WebTerminalProps) {
    const { theme } = useUnistyles();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<any>(null);
    const fitAddonRef = useRef<any>(null);
    const serializeAddonRef = useRef<any>(null);
    const terminalIdRef = useRef<string | null>(null);
    // True when the current xterm started life by writing a persisted
    // snapshot from localStorage — used to skip the daemon's `recentOutput`
    // replay path so the two don't stomp on each other with a fresh
    // clear-screen erasing the restored history.
    const restoredFromCacheRef = useRef<boolean>(false);
    // Debounce handle for xtermSnapshotCache writes. See the constant's
    // XTERM_SNAPSHOT_SAVE_DEBOUNCE_MS declaration at the top of this file.
    const snapshotSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [state, setState] = useState<TerminalState>("connecting");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateMsg, setUpdateMsg] = useState<string | null>(null);

    // Stable ref for onClose — avoids including onClose in effect dep arrays,
    // which would cause the terminal to re-initialize every time the parent re-renders.
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    const machine = useMachine(machineId);
    const currentCliVersion = machine?.daemonState?.startedWithCliVersion;
    const { latestVersion, hasUpdate } = useCliVersionCheck(currentCliVersion);
    const cliSelfUpgradeSupport = resolveCliSelfUpgradeSupport(machine);

    // Explicitly close the PTY — called only by user action or shell exit, not on unmount
    const closeTerminal = useCallback(() => {
        if (terminalIdRef.current) {
            machineTerminalClose(machineId, terminalIdRef.current);
            terminalIdRef.current = null;
        }
        if (terminalRef.current) {
            terminalRef.current.dispose();
            terminalRef.current = null;
        }
        setState("disconnected");
        onCloseRef.current?.();
    }, [machineId]);

    useEffect(() => {
        let mounted = true;
        let outputCleanup: (() => void) | null = null;
        let exitCleanup: (() => void) | null = null;
        let resizeObserver: ResizeObserver | null = null;

        async function init() {
            const [
                { Terminal },
                { FitAddon },
                { WebLinksAddon },
                { SerializeAddon },
            ] = await Promise.all([
                import("@xterm/xterm"),
                import("@xterm/addon-fit"),
                import("@xterm/addon-web-links"),
                import("@xterm/addon-serialize"),
            ]);

            if (!document.querySelector('link[data-xterm-css]')) {
                const link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = "https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.min.css";
                link.setAttribute("data-xterm-css", "true");
                document.head.appendChild(link);
            }

            // Symbols Nerd Font (mono) patches PUA glyphs like  (git branch, U+E0A0)
            // used by oh-my-zsh / starship / powerline prompts. System fonts (SF Mono / Menlo)
            // don't carry these codepoints; unicode-range limits this font to symbol ranges
            // so regular text still renders with the primary font.
            if (!document.querySelector('style[data-nerd-font]')) {
                const nerdFontUri = Asset.fromModule(require("@/assets/fonts/SymbolsNerdFontMono-Regular.ttf")).uri;
                const style = document.createElement("style");
                style.setAttribute("data-nerd-font", "true");
                style.textContent = "@font-face {"
                    + " font-family: 'Symbols Nerd Font';"
                    + " src: url('" + nerdFontUri + "') format('truetype');"
                    + " font-display: swap;"
                    + " unicode-range: U+23FB-23FE, U+2B58, U+E000-E00A, U+E0A0-E0A3, U+E0B0-E0D4, U+E200-E2A9, U+E300-E3E3, U+E5FA-E6B7, U+E700-E8EF, U+EA60-EC1E, U+ED00-EFCE, U+F000-F2FF, U+F300-F381, U+F400-F533, U+F0001-F1AF0;"
                    + " }";
                document.head.appendChild(style);
            }

            if (!mounted || !containerRef.current) return;

            const bg = theme.colors.groupped?.background ?? "#000000";
            const isDark = bg === "#000000" || bg.startsWith("#0") || bg.startsWith("#1");

            const terminal = new Terminal({
                cursorBlink: true,
                fontSize: 14,
                fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', 'Symbols Nerd Font', monospace",
                theme: {
                    background: isDark ? "#1a1a2e" : "#ffffff",
                    foreground: isDark ? "#e0e0e0" : "#1a1a1a",
                    cursor: isDark ? "#e0e0e0" : "#1a1a1a",
                    selectionBackground: isDark ? "#44475a" : "#b5d5ff",
                },
                allowProposedApi: true,
            });

            const fitAddon = new FitAddon();
            const webLinksAddon = new WebLinksAddon();
            const serializeAddon = new SerializeAddon();
            terminal.loadAddon(fitAddon);
            terminal.loadAddon(webLinksAddon);
            terminal.loadAddon(serializeAddon);
            terminalRef.current = terminal;
            fitAddonRef.current = fitAddon;
            serializeAddonRef.current = serializeAddon;

            terminal.open(containerRef.current);

            // Cache key for xterm state persistence — `terminalId` when the
            // parent (Claude tab / multi-shell tab) already knows it (they
            // pass in the deterministic `claude:<sessionId>` for the Claude
            // PTY, or a cuid2 for shells); a synthetic `claude:<sessionId>`
            // key when we only have `sessionId` at mount time. `null` means
            // we can't persist meaningfully (no id available) — skip.
            //
            // Restoring here (before `machineTerminalSpawn` fires the RPC
            // that would return `recentOutput`) means the user sees the
            // pre-refresh screen instantly on remount; the daemon path only
            // fills in when no client-side cache exists.
            const cacheKey =
                terminalIdProp ?? (sessionId ? `claude:${sessionId}` : null);
            let restoredFromCache = false;
            if (cacheKey) {
                const snapshot = loadXtermSnapshot(cacheKey);
                if (snapshot) {
                    try {
                        terminal.write(snapshot);
                        restoredFromCache = true;
                    } catch {
                        // Corrupt snapshot — fall back to daemon flow.
                    }
                }
            }
            restoredFromCacheRef.current = restoredFromCache;

            // Fit synchronously so cols/rows reflect actual container size before spawn
            try { fitAddon.fit(); } catch { /* ignore */ }

            // Sanity-check the initial fit. When the side panel is animating in,
            // the container's `getBoundingClientRect()` can briefly be 0 (or a
            // single character cell — RN Web's `<View style={{ flex: 1 }}>` is
            // a `<div>` whose layout hasn't settled yet). FitAddon then computes
            // cols≈1/rows≈1 and we spawn the PTY at 1x1, causing Claude TUI to
            // emit ANSI sequences against a window that's essentially a single
            // cell — the App sees either a near-blank panel with isolated chars
            // (the "9 / 7" symptom) or wider-PTY-vs-narrower-xterm overdraw with
            // cursor-positioning offsets (the "/User7/.../Documsnts/" symptom).
            // Wait one rAF and refit when this happens; if still degenerate
            // after the retry, fall through to spawn with what we have — the
            // ResizeObserver below picks up the eventual settle and re-fits.
            if (terminal.cols < 20 || terminal.rows < 5) {
                await new Promise<void>((resolve) =>
                    typeof requestAnimationFrame === "function"
                        ? requestAnimationFrame(() => resolve())
                        : setTimeout(resolve, 16),
                );
                if (!mounted || !containerRef.current) return;
                try { fitAddon.fit(); } catch { /* ignore */ }
            }

            const cols = terminal.cols;
            const rows = terminal.rows;

            // Container-driven re-fit: any time the panel resizes (user drags
            // the split bar, side panel collapses/expands, mobile keyboard
            // shows/hides, parent re-lays out after a tab switch), keep xterm's
            // cols/rows in sync with the actual pixel size. Without this the
            // only re-fit trigger is the global `window.resize` listener below,
            // which never fires for in-page layout changes — and any drift
            // between xterm's cols and the daemon PTY's cols re-introduces the
            // overdraw / corruption ("/User7/.../Documsnts/") because Claude
            // TUI's cursor-positioning ANSI escapes target one width while the
            // viewport renders at another.
            //
            // fit() internally calls terminal.resize(cols, rows) when the
            // computed dims differ, which fires terminal.onResize → the
            // machineTerminalResize RPC below — so the daemon stays aligned
            // automatically. If the new dims also differ from what the PTY
            // last rendered with, we additionally write a local erase-display
            // + cursor-home (CSI 2J + CSI H) to clear the stale frame xterm
            // still has on screen; Claude TUI's next redraw (triggered by
            // SIGWINCH on the daemon side) repaints the live state on top of
            // a clean slate, suppressing the multi-frame overdraw symptom.
            if (typeof ResizeObserver !== "undefined" && containerRef.current) {
                let lastCols = terminal.cols;
                let lastRows = terminal.rows;
                resizeObserver = new ResizeObserver(() => {
                    if (!fitAddonRef.current || !terminalRef.current) return;
                    try {
                        fitAddonRef.current.fit();
                    } catch {
                        return;
                    }
                    const nextCols = terminalRef.current.cols;
                    const nextRows = terminalRef.current.rows;
                    if (nextCols !== lastCols || nextRows !== lastRows) {
                        lastCols = nextCols;
                        lastRows = nextRows;
                        // Local clear only — does NOT send anything to the PTY.
                        // SIGWINCH already went out via fit()'s onResize hook
                        // a few lines above; Claude TUI will repaint shortly.
                        try {
                            terminalRef.current.write("\x1b[2J\x1b[H");
                        } catch { /* ignore */ }
                    }
                });
                resizeObserver.observe(containerRef.current);
            }

            // Debounced persistence of the xterm's serialized state. Called
            // after every incoming byte on the terminal; the debounce means a
            // streaming burst only writes once at the tail so the hot path
            // stays cheap. See xtermSnapshotCache.ts for storage semantics.
            const scheduleSnapshotSave = () => {
                if (!cacheKey || !serializeAddonRef.current) return;
                if (snapshotSaveTimerRef.current) {
                    clearTimeout(snapshotSaveTimerRef.current);
                }
                snapshotSaveTimerRef.current = setTimeout(() => {
                    snapshotSaveTimerRef.current = null;
                    if (!serializeAddonRef.current) return;
                    try {
                        const serialized = serializeAddonRef.current.serialize();
                        saveXtermSnapshot(cacheKey, serialized);
                    } catch {
                        // SerializeAddon can throw if the terminal was
                        // disposed between the schedule and the fire — no-op.
                    }
                }, XTERM_SNAPSHOT_SAVE_DEBOUNCE_MS);
            };

            // Register listener BEFORE spawn to buffer events arriving during RPC round-trip
            const pendingEvents: any[] = [];
            outputCleanup = apiSocket.addEphemeralListener((data: any) => {
                if (data.machineId !== machineId) return;
                if (!terminalIdRef.current) {
                    if (data.type === "terminal-output" || data.type === "terminal-exit") {
                        pendingEvents.push(data);
                    }
                    return;
                }
                if (data.terminalId !== terminalIdRef.current) return;
                if (data.type === "terminal-output") {
                    terminal.write(data.data);
                    scheduleSnapshotSave();
                }
                if (data.type === "terminal-exit") {
                    terminal.write(`\r\n\x1b[90m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`);
                    setState("disconnected");
                    terminalIdRef.current = null;
                    // Persist the final state — the user can Retry from here,
                    // which remounts and restores from the snapshot we just
                    // saved; without this, the "[Process exited]" line and
                    // whatever came before would be lost on remount.
                    scheduleSnapshotSave();
                    onCloseRef.current?.();
                }
            });

            // Spawn or reattach. Pass terminalId for precise reattach; otherwise sessionId for session-scoped creation.
            const result = await machineTerminalSpawn(machineId, { cwd, cols, rows, sessionId, terminalId: terminalIdProp });
            if (!mounted) return;

            if (!result.success || !result.terminalId) {
                setState("error");
                setErrorMsg(result.error || t("webTerminal.spawnFailed"));
                return;
            }

            terminalIdRef.current = result.terminalId;

            // Reattach: replay buffered output from CLI — but skip when we
            // already restored from the client-side snapshot cache. The
            // daemon buffer is capped at 256 KB and drops history at
            // clear-screen / alt-screen sync points; the client cache is a
            // strict superset of that, so writing both would only add
            // duplication (and a spurious clear-screen inside the daemon
            // snapshot would erase the restored history).
            if (
                result.isExisting &&
                result.recentOutput &&
                !restoredFromCacheRef.current
            ) {
                terminal.write(result.recentOutput);
            }

            // Capture the initial screen — either from the persisted snapshot
            // we restored, or from the daemon's recentOutput. Ensures a fresh
            // spawn (no reattach) also gets its very first state saved.
            scheduleSnapshotSave();

            setState("connected");

            // Replay any socket events that arrived during the spawn RPC
            for (const data of pendingEvents) {
                if (data.terminalId !== terminalIdRef.current) continue;
                if (data.type === "terminal-output") {
                    terminal.write(data.data);
                    scheduleSnapshotSave();
                }
                if (data.type === "terminal-exit") {
                    terminal.write(`\r\n\x1b[90m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`);
                    scheduleSnapshotSave();
                    setState("disconnected");
                    terminalIdRef.current = null;
                    onCloseRef.current?.();
                    break;
                }
            }

            terminal.onData((data: string) => {
                if (terminalIdRef.current) {
                    machineTerminalInput(machineId, terminalIdRef.current, data);
                }
            });

            terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
                if (terminalIdRef.current) {
                    machineTerminalResize(machineId, terminalIdRef.current, cols, rows);
                }
            });

            const onWindowResize = () => {
                try { fitAddon.fit(); } catch { /* ignore */ }
            };
            window.addEventListener("resize", onWindowResize);
            exitCleanup = () => window.removeEventListener("resize", onWindowResize);
        }

        init().catch((err) => {
            if (terminalRef.current) {
                terminalRef.current.dispose();
                terminalRef.current = null;
            }
            fitAddonRef.current = null;
            // 旧 entry chunk 引用了已被新部署覆盖的 xterm hash chunk 时会走到这里。
            // 不展示「重新连接」按钮（点了也没用 — entry chunk 还在内存里），
            // 直接整页 reload 让浏览器拉新 entry。chunkReloadGuard 内部有 10s 防抖。
            if (isChunkLoadError(err)) {
                attemptChunkReload(`WebTerminal init: ${err?.message ?? err}`);
                return;
            }
            if (mounted) {
                setState("error");
                setErrorMsg(err.message || t("webTerminal.initFailed"));
            }
        });

        return () => {
            mounted = false;
            outputCleanup?.();
            exitCleanup?.();
            resizeObserver?.disconnect();
            resizeObserver = null;
            // Force-flush one last serialization before we lose the addon
            // instance — the debounced timer would otherwise fire against a
            // disposed terminal and get nothing. This is why tabbing away
            // and back preserves the exact pre-blur screen instead of the
            // "1.5 s ago" screen the last scheduled write captured.
            const flushKey =
                terminalIdRef.current ??
                terminalIdProp ??
                (sessionId ? `claude:${sessionId}` : null);
            if (snapshotSaveTimerRef.current) {
                clearTimeout(snapshotSaveTimerRef.current);
                snapshotSaveTimerRef.current = null;
            }
            if (flushKey && serializeAddonRef.current) {
                try {
                    const serialized = serializeAddonRef.current.serialize();
                    saveXtermSnapshot(flushKey, serialized);
                } catch {
                    // ignore — terminal may already be mid-teardown
                }
            }
            // Detach only: don't close the PTY — it stays alive for reattach
            if (terminalRef.current) {
                terminalRef.current.dispose();
                terminalRef.current = null;
            }
            serializeAddonRef.current = null;
            terminalIdRef.current = null;
        };
    }, [machineId, cwd, sessionId, terminalIdProp, theme.colors.groupped?.background, retryKey]);

    // When this terminal's tab becomes active after being HIDDEN, re-fit so dimensions are correct.
    // Skip the initial mount — the terminal is already sized correctly by the init effect's synchronous fit().
    const isActivePrevRef = useRef<boolean | undefined>(undefined);
    useEffect(() => {
        const prev = isActivePrevRef.current;
        isActivePrevRef.current = isActive;
        // Only fit when transitioning false → true (not on initial mount)
        if (isActive && prev === false && fitAddonRef.current) {
            requestAnimationFrame(() => {
                try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
            });
        }
    }, [isActive]);

    const handleRetry = React.useCallback(() => {
        setState("connecting");
        setErrorMsg(null);
        setUpdateMsg(null);
        setRetryKey((k) => k + 1);
    }, []);

    const handleUpdateCli = React.useCallback(async () => {
        if (!latestVersion || isUpdating) return;
        setIsUpdating(true);
        setUpdateMsg(t("webTerminal.updating"));
        try {
            const result = await machineUpgradeCli(
                machineId,
                latestVersion,
            );
            if (!result.success) {
                setUpdateMsg(result.error ?? t("webTerminal.updateFailed"));
                setIsUpdating(false);
                return;
            }
            setUpdateMsg(t("webTerminal.updateWaiting"));
            const upgraded = await waitForMachineCliVersion(machineId, latestVersion);
            if (!upgraded) {
                setUpdateMsg(t("webTerminal.updateFailed"));
                setIsUpdating(false);
                return;
            }
            setIsUpdating(false);
            handleRetry();
        } catch {
            setUpdateMsg(t("webTerminal.updateFailed"));
            setIsUpdating(false);
        }
    }, [latestVersion, isUpdating, machineId, handleRetry]);

    if (state === "error" || state === "disconnected") {
        const btnBase: React.CSSProperties = {
            marginTop: 8,
            padding: "8px 20px",
            borderRadius: 8,
            border: "none",
            fontSize: 14,
            cursor: isUpdating ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            opacity: isUpdating ? 0.6 : 1,
        };
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
                <Text style={{
                    ...Typography.default("semiBold"),
                    fontSize: 16,
                    color: state === "error" ? (theme.colors.textDestructive ?? "#ff3b30") : theme.colors.textSecondary,
                    textAlign: "center",
                    marginBottom: 8,
                }}>
                    {state === "error" ? t("webTerminal.connectionFailed") : t("webTerminal.disconnected")}
                </Text>
                {(errorMsg || updateMsg) && (
                    <Text style={{
                        ...Typography.default(),
                        fontSize: 13,
                        color: theme.colors.textSecondary,
                        textAlign: "center",
                        marginBottom: 20,
                    }}>
                        {updateMsg ?? errorMsg}
                    </Text>
                )}
                {!isUpdating && (
                    <button
                        onClick={handleRetry}
                        style={{ ...btnBase, background: theme.colors.accentBlue ?? "#007aff", color: "#fff" }}
                    >
                        {t("webTerminal.retry")}
                    </button>
                )}
                {hasUpdate && latestVersion && cliSelfUpgradeSupport.canSelfUpgrade && !isUpdating && (
                    <button
                        onClick={handleUpdateCli}
                        style={{ ...btnBase, background: "transparent", color: theme.colors.textSecondary, border: `1px solid ${theme.colors.divider}` }}
                    >
                        {t("webTerminal.updateCli", { version: latestVersion })}
                    </button>
                )}
                {isUpdating && (
                    <Text style={{ ...Typography.default(), fontSize: 13, color: theme.colors.textSecondary, marginTop: 8 }}>
                        {updateMsg}
                    </Text>
                )}
            </View>
        );
    }

    return (
        <View style={{ flex: 1, position: "relative" }}>
            {/* Close button — top-right corner, only when connected and not managed by parent */}
            {state === "connected" && showInternalCloseButton && (
                <Pressable
                    onPress={closeTerminal}
                    style={{
                        position: "absolute",
                        top: 6,
                        right: 8,
                        zIndex: 20,
                        padding: 4,
                        borderRadius: 4,
                        backgroundColor: "rgba(0,0,0,0.3)",
                    }}
                    hitSlop={8}
                >
                    <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
            )}
            {state === "connecting" && (
                <View style={{
                    position: "absolute",
                    top: 0, left: 0, right: 0, bottom: 0,
                    justifyContent: "center",
                    alignItems: "center",
                    zIndex: 10,
                    backgroundColor: theme.colors.groupped?.background,
                }}>
                    <Text style={{ ...Typography.default(), color: theme.colors.textSecondary }}>
                        {t("webTerminal.connecting")}
                    </Text>
                </View>
            )}
            <div
                ref={containerRef}
                style={{ width: "100%", height: "100%", overflow: "hidden", cursor: "text" }}
            />
        </View>
    );
}

export const WebTerminal = React.memo(WebTerminalComponent);
