/**
 * WebTerminal — xterm.js web terminal, multi-session, web-only.
 * Uses pure HTML divs (no React Native Views) to avoid RN flex height propagation
 * issues that cause xterm canvas to render at 0×0.
 *
 * Key timing invariant:
 *   terminal.open() MUST be called after React commits "connected" state to DOM,
 *   so the xterm container has display:block and real dimensions.
 *   useEffect([state, visible]) guarantees this; requestAnimationFrame does NOT
 *   (React 18 batches state updates — rAF may fire before the DOM is updated).
 */
import React, { useRef, useEffect, useCallback, useState } from "react";
import { useUnistyles } from "react-native-unistyles";
import { apiSocket } from "@/sync/apiSocket";
import {
    machineTerminalSpawn,
    machineTerminalClose,
    machineTerminalResize,
    machineTerminalInput,
    machineUpgradeCli,
    machineTerminalCloseAll,
} from "@/sync/ops";
import { useMachine } from "@/sync/storage";
import { useCliVersionCheck } from "@/hooks/useCliVersionCheck";
import { t } from "@/text";
import { createId } from "@paralleldrive/cuid2";

const MAX_SESSIONS = 5;
const TAB_BAR_H = 34;

interface WebTerminalProps {
    machineId: string;
    cwd?: string;
}

type PaneState = "connecting" | "connected" | "disconnected" | "error";

interface TerminalTab {
    id: string;
    index: number;
}

// ─────────────────────────────────────────────────────────────
// TerminalPane — single PTY session + xterm instance
// ─────────────────────────────────────────────────────────────

interface TerminalPaneProps {
    machineId: string;
    cwd?: string;
    visible: boolean;
    onStateChange: (state: PaneState) => void;
    onClose: () => void;
    latestVersion: string | null;
    hasUpdate: boolean;
    canClose: boolean;
}

const TerminalPane = React.memo(function TerminalPane({
    machineId, cwd, visible, onStateChange, onClose, latestVersion, hasUpdate,
    canClose,
}: TerminalPaneProps) {
    const { theme } = useUnistyles();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mobileInputRef = useRef<HTMLTextAreaElement | null>(null);
    const terminalRef = useRef<any>(null);
    const fitAddonRef = useRef<any>(null);
    const terminalIdRef = useRef<string | null>(null);
    // Buffer for events that arrive before xterm is opened (open happens after React commits)
    const pendingEventsRef = useRef<any[]>([]);
    // Track whether terminal.open() has been called (safe to write to xterm)
    const xtermOpenedRef = useRef(false);

    const [state, setState] = useState<PaneState>("connecting");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateMsg, setUpdateMsg] = useState<string | null>(null);
    const [isMaxReached, setIsMaxReached] = useState(false);

    const updateState = useCallback((s: PaneState) => {
        setState(s);
        onStateChange(s);
    }, [onStateChange]);

    const cleanup = useCallback(() => {
        if (terminalIdRef.current) {
            machineTerminalClose(machineId, terminalIdRef.current);
            terminalIdRef.current = null;
        }
        if (terminalRef.current) {
            terminalRef.current.dispose();
            terminalRef.current = null;
        }
        fitAddonRef.current = null;
        xtermOpenedRef.current = false;
        pendingEventsRef.current = [];
    }, [machineId]);

    // ── Open xterm after React commits "connected" state ──────────────────────
    // useEffect fires after React flushes the state update to the DOM.
    // At this point display:none has flipped to display:block on the container,
    // so terminal.open() gets real pixel dimensions and the canvas is sized correctly.
    // We also require visible=true so we get real (non-zero) container dimensions.
    useEffect(() => {
        if (state !== "connected") return;
        if (xtermOpenedRef.current) return;
        if (!visible) return; // wait until tab is in view
        if (!containerRef.current || !terminalRef.current || !fitAddonRef.current) return;

        xtermOpenedRef.current = true;
        terminalRef.current.open(containerRef.current);
        try {
            fitAddonRef.current.fit();
            if (terminalIdRef.current) {
                machineTerminalResize(
                    machineId,
                    terminalIdRef.current,
                    terminalRef.current.cols,
                    terminalRef.current.rows,
                );
            }
        } catch { /* ignore */ }

        // Replay output that arrived before xterm was ready
        const pending = pendingEventsRef.current.splice(0);
        for (const data of pending) {
            if (data.terminalId !== terminalIdRef.current) continue;
            if (data.type === "terminal-output") {
                terminalRef.current!.write(data.data);
            } else if (data.type === "terminal-exit") {
                terminalRef.current!.write(
                    `\r\n\x1b[90m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`,
                );
                updateState("disconnected");
                terminalIdRef.current = null;
                break;
            }
        }
    }, [state, visible, machineId, updateState]);

    // ── Re-fit when tab becomes visible (tab switch back) ─────────────────────
    useEffect(() => {
        if (!visible || !xtermOpenedRef.current || !fitAddonRef.current || !containerRef.current) return;
        const { width, height } = containerRef.current.getBoundingClientRect();
        if (width > 0 && height > 0) {
            try {
                fitAddonRef.current.fit();
                if (terminalIdRef.current && terminalRef.current) {
                    machineTerminalResize(
                        machineId,
                        terminalIdRef.current,
                        terminalRef.current.cols,
                        terminalRef.current.rows,
                    );
                }
            } catch { /* ignore */ }
        }
    }, [visible, machineId]);

    // ── Spawn PTY and wire up xterm ───────────────────────────────────────────
    useEffect(() => {
        let mounted = true;
        let outputCleanup: (() => void) | null = null;
        let resizeCleanup: (() => void) | null = null;

        async function init() {
            const [{ Terminal }, { FitAddon }] = await Promise.all([
                import("@xterm/xterm"),
                import("@xterm/addon-fit"),
            ]);

            if (!document.querySelector('link[data-xterm-css]')) {
                const link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = "https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.min.css";
                link.setAttribute("data-xterm-css", "true");
                document.head.appendChild(link);
            }

            if (!mounted) return;

            const bg = theme.colors.groupped?.background ?? "#000000";
            const isDark = bg === "#000000" || bg.startsWith("#0") || bg.startsWith("#1");

            const terminal = new Terminal({
                cursorBlink: true,
                fontSize: 13,
                fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
                theme: {
                    background: isDark ? "#1a1a2e" : "#ffffff",
                    foreground: isDark ? "#e0e0e0" : "#1a1a1a",
                    cursor: isDark ? "#e0e0e0" : "#1a1a1a",
                    selectionBackground: isDark ? "#44475a" : "#b5d5ff",
                },
                allowProposedApi: true,
            });

            const fitAddon = new FitAddon();
            terminal.loadAddon(fitAddon);
            terminalRef.current = terminal;
            fitAddonRef.current = fitAddon;

            // Wire up input handlers (safe before open())
            terminal.onData((data: string) => {
                if (terminalIdRef.current) machineTerminalInput(machineId, terminalIdRef.current, data);
            });
            terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
                if (terminalIdRef.current) machineTerminalResize(machineId, terminalIdRef.current, cols, rows);
            });

            // Buffer ALL output until xterm is opened (xtermOpenedRef becomes true).
            // This covers events that arrive:
            //  - before terminalId is known (race with spawn response)
            //  - after terminalId is known but before React commits "connected" state
            pendingEventsRef.current = [];
            outputCleanup = apiSocket.onMessage("ephemeral", (data: any) => {
                if (data.machineId !== machineId) return;
                if (!xtermOpenedRef.current || !terminalIdRef.current) {
                    // Buffer everything until xterm is ready
                    if (data.type === "terminal-output" || data.type === "terminal-exit") {
                        pendingEventsRef.current.push(data);
                    }
                    return;
                }
                if (data.terminalId !== terminalIdRef.current) return;
                if (data.type === "terminal-output") terminal.write(data.data);
                if (data.type === "terminal-exit") {
                    terminal.write(
                        `\r\n\x1b[90m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`,
                    );
                    updateState("disconnected");
                    terminalIdRef.current = null;
                }
            });

            const result = await machineTerminalSpawn(machineId, { cwd, cols: 80, rows: 24 });
            if (!mounted) return;

            if (!result.success || !result.terminalId) {
                updateState("error");
                const err = result.error || t("webTerminal.spawnFailed");
                setErrorMsg(err);
                setIsMaxReached(err.toLowerCase().includes("maximum") && err.toLowerCase().includes("reached"));
                return;
            }

            terminalIdRef.current = result.terminalId;

            // Window resize handler (fit while xterm is open)
            const onWindowResize = () => {
                if (xtermOpenedRef.current) {
                    try { fitAddon.fit(); } catch { /* ignore */ }
                }
            };
            window.addEventListener("resize", onWindowResize);
            resizeCleanup = () => { window.removeEventListener("resize", onWindowResize); };

            // Signal "connected" — useEffect([state, visible]) will call terminal.open()
            // after React commits this state update and the container is display:block.
            updateState("connected");
        }

        init().catch((err) => {
            if (mounted) {
                updateState("error");
                setErrorMsg(err.message || t("webTerminal.initFailed"));
            }
        });

        return () => {
            mounted = false;
            outputCleanup?.();
            resizeCleanup?.();
            cleanup();
        };
    }, [machineId, cwd, theme.colors.groupped?.background, cleanup, updateState, retryKey]);

    const handleRetry = useCallback(() => {
        updateState("connecting");
        setErrorMsg(null);
        setUpdateMsg(null);
        setIsMaxReached(false);
        setRetryKey((k) => k + 1);
    }, [updateState]);

    const handleCloseAllAndRetry = useCallback(async () => {
        setErrorMsg(t("webTerminal.clearingAll"));
        await machineTerminalCloseAll(machineId);
        handleRetry();
    }, [machineId, handleRetry]);

    const handleUpdateCli = useCallback(async () => {
        if (!latestVersion || isUpdating) return;
        setIsUpdating(true);
        setUpdateMsg(t("webTerminal.updating"));
        try {
            const result = await machineUpgradeCli(machineId, latestVersion);
            if (!result.success) {
                setUpdateMsg(result.error ?? t("webTerminal.updateFailed"));
                setIsUpdating(false);
                return;
            }
            setUpdateMsg(t("webTerminal.updateWaiting"));
            setTimeout(() => { setIsUpdating(false); handleRetry(); }, 65_000);
        } catch {
            setUpdateMsg(t("webTerminal.updateFailed"));
            setIsUpdating(false);
        }
    }, [latestVersion, isUpdating, machineId, handleRetry]);

    // Mobile keyboard: tap anywhere on terminal → focus hidden textarea → OS keyboard appears
    const focusMobileInput = useCallback(() => { mobileInputRef.current?.focus(); }, []);

    const onMobileInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
        const target = e.target as HTMLTextAreaElement;
        const val = target.value;
        if (val && terminalIdRef.current) {
            machineTerminalInput(machineId, terminalIdRef.current, val);
            target.value = "";
        }
    }, [machineId]);

    const onMobileKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (!terminalIdRef.current) return;
        if (e.ctrlKey) {
            const ctrlSeqs: Record<string, string> = { c: "\x03", d: "\x04", z: "\x1a", l: "\x0c", a: "\x01", e: "\x05" };
            const seq = ctrlSeqs[e.key.toLowerCase()];
            if (seq) { e.preventDefault(); machineTerminalInput(machineId, terminalIdRef.current, seq); return; }
        }
        const specialSeqs: Record<string, string> = {
            Enter: "\r", Backspace: "\x7f", Tab: "\t", Escape: "\x1b",
            ArrowUp: "\x1b[A", ArrowDown: "\x1b[B", ArrowRight: "\x1b[C", ArrowLeft: "\x1b[D",
            Delete: "\x1b[3~", Home: "\x1b[H", End: "\x1b[F",
        };
        const seq = specialSeqs[e.key];
        if (seq) { e.preventDefault(); machineTerminalInput(machineId, terminalIdRef.current, seq); }
    }, [machineId]);

    const colors = theme.colors;
    const showTerminal = state === "connected" || state === "disconnected";
    const showActionBar = state === "disconnected";
    const showOverlay = state === "connecting" || state === "error";

    const btnStyle = (primary: boolean): React.CSSProperties => ({
        padding: "7px 18px", borderRadius: 8, fontSize: 13, fontFamily: "inherit",
        cursor: "pointer", border: primary ? "none" : `1px solid ${colors.divider}`,
        background: primary ? (colors.accentBlue ?? "#007aff") : "transparent",
        color: primary ? "#fff" : colors.textSecondary,
    });

    return (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", width: "100%", overflow: "hidden", position: "relative" }}>
            {/* Hidden textarea for mobile keyboard input */}
            <textarea
                ref={mobileInputRef}
                onInput={onMobileInput}
                onKeyDown={onMobileKeyDown}
                style={{
                    position: "absolute", opacity: 0, width: 1, height: 1,
                    top: 0, left: 0, border: "none", outline: "none",
                    resize: "none", padding: 0, margin: 0, zIndex: -1,
                } as React.CSSProperties}
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-hidden="true"
            />

            {/* xterm container — hidden during connecting/error, shown once connected */}
            <div
                ref={containerRef}
                onClick={focusMobileInput}
                onTouchEnd={focusMobileInput}
                style={{
                    flex: 1,
                    minHeight: 0,
                    width: "100%",
                    overflow: "hidden",
                    cursor: "text",
                    display: showTerminal ? "block" : "none",
                    backgroundColor: theme.colors.groupped?.background ?? "#1a1a2e",
                }}
            />

            {/* Disconnected action bar */}
            {showActionBar && (
                <div style={{
                    height: 48, display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 8, borderTop: `1px solid ${colors.divider}`,
                    backgroundColor: colors.surface, flexShrink: 0,
                }}>
                    <button onClick={handleRetry} style={btnStyle(true)}>{t("webTerminal.retry")}</button>
                    {hasUpdate && latestVersion && (
                        <button onClick={handleUpdateCli} style={btnStyle(false)}>
                            {t("webTerminal.updateCli", { version: latestVersion })}
                        </button>
                    )}
                </div>
            )}

            {/* Connecting / Error overlay */}
            {showOverlay && (
                <div style={{
                    position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", padding: 32,
                    backgroundColor: colors.groupped?.background ?? "#1a1a2e", zIndex: 10,
                }}>
                    {state === "connecting" ? (
                        <span style={{ fontSize: 14, color: colors.textSecondary, fontFamily: "inherit" }}>
                            {t("webTerminal.connecting")}
                        </span>
                    ) : (
                        <>
                            <span style={{ fontSize: 15, fontWeight: 600, color: colors.textDestructive ?? "#ff3b30", marginBottom: 8, fontFamily: "inherit", textAlign: "center" }}>
                                {t("webTerminal.connectionFailed")}
                            </span>
                            {(errorMsg || updateMsg) && (
                                <span style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 20, fontFamily: "inherit", textAlign: "center" }}>
                                    {updateMsg ?? errorMsg}
                                </span>
                            )}
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                                {!isUpdating && <button onClick={handleRetry} style={btnStyle(true)}>{t("webTerminal.retry")}</button>}
                                {isMaxReached && !isUpdating && (
                                    <button onClick={handleCloseAllAndRetry} style={{ ...btnStyle(false), color: colors.textDestructive ?? "#ff3b30", border: `1px solid ${colors.textDestructive ?? "#ff3b30"}` }}>
                                        {t("webTerminal.clearAllSessions")}
                                    </button>
                                )}
                                {hasUpdate && latestVersion && !isUpdating && (
                                    <button onClick={handleUpdateCli} style={btnStyle(false)}>
                                        {t("webTerminal.updateCli", { version: latestVersion })}
                                    </button>
                                )}
                                {canClose && !isUpdating && (
                                    <button onClick={onClose} style={{ ...btnStyle(false), border: "none" }}>
                                        {t("webTerminal.closeSession")}
                                    </button>
                                )}
                                {isUpdating && (
                                    <span style={{ fontSize: 12, color: colors.textSecondary, fontFamily: "inherit" }}>{updateMsg}</span>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
});

// ─────────────────────────────────────────────────────────────
// WebTerminal — multi-session tab manager
// ─────────────────────────────────────────────────────────────

function WebTerminalComponent({ machineId, cwd }: WebTerminalProps) {
    const { theme } = useUnistyles();
    const [tabs, setTabs] = useState<TerminalTab[]>(() => [{ id: createId(), index: 1 }]);
    const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
    const [tabStates, setTabStates] = useState<Record<string, PaneState>>({});
    const nextIndexRef = useRef(2);

    const machine = useMachine(machineId);
    const currentCliVersion = machine?.daemonState?.startedWithCliVersion;
    const { latestVersion, hasUpdate } = useCliVersionCheck(currentCliVersion);

    const handleStateChange = useCallback((tabId: string, state: PaneState) => {
        setTabStates((prev) => ({ ...prev, [tabId]: state }));
    }, []);

    const handleAddTab = useCallback(() => {
        if (tabs.length >= MAX_SESSIONS) return;
        const id = createId();
        const index = nextIndexRef.current++;
        setTabs((prev) => [...prev, { id, index }]);
        setActiveTabId(id);
    }, [tabs.length]);

    const handleCloseTab = useCallback((tabId: string) => {
        setTabs((prev) => {
            if (prev.length === 1) return prev;
            const idx = prev.findIndex((t) => t.id === tabId);
            const next = prev.filter((t) => t.id !== tabId);
            if (activeTabId === tabId) setActiveTabId(next[Math.max(0, idx - 1)].id);
            return next;
        });
        setTabStates((prev) => { const { [tabId]: _, ...rest } = prev; return rest; });
    }, [activeTabId]);

    const dotColor = (state: PaneState | undefined): string => {
        if (state === "connected") return "#34c759";
        if (state === "error" || state === "disconnected") return theme.colors.textDestructive ?? "#ff3b30";
        return theme.colors.textSecondary; // connecting
    };

    const colors = theme.colors;

    return (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", width: "100%", overflow: "hidden" }}>
            {/* Tab bar */}
            <div style={{
                height: TAB_BAR_H, display: "flex", alignItems: "stretch", flexShrink: 0,
                borderBottom: `1px solid ${colors.divider}`,
                backgroundColor: colors.surfaceHigh,
                overflowX: "auto", overflowY: "hidden",
            }}>
                {tabs.map((tab) => {
                    const isActive = tab.id === activeTabId;
                    return (
                        <div key={tab.id} onClick={() => setActiveTabId(tab.id)} style={{
                            display: "flex", alignItems: "center", gap: 5,
                            paddingLeft: 10, paddingRight: 6, cursor: "pointer", flexShrink: 0,
                            minWidth: 80, maxWidth: 120,
                            borderBottom: isActive ? `2px solid ${colors.textLink}` : "2px solid transparent",
                            backgroundColor: isActive ? (colors.surface ?? "transparent") : "transparent",
                        }}>
                            <div style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, backgroundColor: dotColor(tabStates[tab.id]) }} />
                            <span style={{
                                fontSize: 12, fontFamily: "inherit", flex: 1,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                color: isActive ? colors.text : colors.textSecondary,
                            }}>
                                {t("webTerminal.sessionLabel", { n: tab.index })}
                            </span>
                            {tabs.length > 1 && (
                                <button onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }} style={{
                                    background: "none", border: "none", padding: "2px", cursor: "pointer",
                                    color: colors.textSecondary, fontSize: 14, lineHeight: 1,
                                    display: "flex", alignItems: "center", flexShrink: 0,
                                }}>×</button>
                            )}
                        </div>
                    );
                })}
                {tabs.length < MAX_SESSIONS && (
                    <button onClick={handleAddTab} title={t("webTerminal.newSession")} style={{
                        background: "none", border: "none", padding: "0 12px",
                        cursor: "pointer", color: colors.textSecondary, fontSize: 20, flexShrink: 0,
                    }}>+</button>
                )}
            </div>

            {/* Panes */}
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                {tabs.map((tab) => (
                    <div key={tab.id} style={{
                        position: "absolute", inset: 0,
                        display: tab.id === activeTabId ? "flex" : "none",
                        flexDirection: "column",
                    }}>
                        <TerminalPane
                            machineId={machineId}
                            cwd={cwd}
                            visible={tab.id === activeTabId}
                            onStateChange={(s) => handleStateChange(tab.id, s)}
                            onClose={() => handleCloseTab(tab.id)}
                            latestVersion={latestVersion}
                            hasUpdate={hasUpdate}
                            canClose={tabs.length > 1}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

export const WebTerminal = React.memo(WebTerminalComponent);
