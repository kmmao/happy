/**
 * WebTerminal — xterm.js-based web terminal emulator with multi-session support.
 * Supports up to 5 concurrent PTY sessions per machine, switchable via tab bar.
 *
 * Web-only component (uses DOM APIs).
 */
import React, { useRef, useEffect, useCallback, useState } from "react";
import { View } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
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

interface WebTerminalProps {
    machineId: string;
    cwd?: string;
}

type PaneState = "connecting" | "connected" | "disconnected" | "error";

interface TerminalTab {
    id: string;
    index: number; // 1-based display number
}

// ─────────────────────────────────────────────────────────────
// TerminalPane — manages a single PTY session + xterm instance
// ─────────────────────────────────────────────────────────────

interface TerminalPaneProps {
    machineId: string;
    cwd?: string;
    visible: boolean;
    onStateChange: (state: PaneState) => void;
    onClose: () => void;
    latestVersion: string | null;
    hasUpdate: boolean;
}

const TerminalPane = React.memo(function TerminalPane({
    machineId,
    cwd,
    visible,
    onStateChange,
    onClose,
    latestVersion,
    hasUpdate,
}: TerminalPaneProps) {
    const { theme } = useUnistyles();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<any>(null);
    const fitAddonRef = useRef<any>(null);
    const terminalIdRef = useRef<string | null>(null);
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
    }, [machineId]);

    // Re-fit when tab becomes visible
    useEffect(() => {
        if (!visible || !fitAddonRef.current) return;
        requestAnimationFrame(() => {
            try {
                fitAddonRef.current?.fit();
                if (terminalIdRef.current && terminalRef.current) {
                    machineTerminalResize(
                        machineId,
                        terminalIdRef.current,
                        terminalRef.current.cols,
                        terminalRef.current.rows,
                    );
                }
            } catch { /* ignore */ }
        });
    }, [visible, machineId]);

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

            if (!mounted || !containerRef.current) return;

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

            terminal.open(containerRef.current!);
            try { fitAddon.fit(); } catch { /* ignore */ }

            const cols = terminal.cols;
            const rows = terminal.rows;

            // Register listener BEFORE spawn to avoid race condition
            const pendingEvents: any[] = [];
            outputCleanup = apiSocket.onMessage("ephemeral", (data: any) => {
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
                }
                if (data.type === "terminal-exit") {
                    terminal.write(`\r\n\x1b[90m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`);
                    updateState("disconnected");
                    terminalIdRef.current = null;
                }
            });

            const result = await machineTerminalSpawn(machineId, { cwd, cols, rows });
            if (!mounted) return;

            if (!result.success || !result.terminalId) {
                updateState("error");
                const err = result.error || t("webTerminal.spawnFailed");
                setErrorMsg(err);
                setIsMaxReached(err.toLowerCase().includes("maximum") && err.toLowerCase().includes("reached"));
                return;
            }

            terminalIdRef.current = result.terminalId;
            updateState("connected");

            // Fit to actual visible size now that container is visible
            requestAnimationFrame(() => {
                if (!mounted) return;
                try {
                    fitAddon.fit();
                    if (terminalIdRef.current) {
                        machineTerminalResize(machineId, terminalIdRef.current, terminal.cols, terminal.rows);
                    }
                } catch { /* ignore */ }
            });

            // Replay buffered events
            for (const data of pendingEvents) {
                if (data.terminalId !== terminalIdRef.current) continue;
                if (data.type === "terminal-output") {
                    terminal.write(data.data);
                }
                if (data.type === "terminal-exit") {
                    terminal.write(`\r\n\x1b[90m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`);
                    updateState("disconnected");
                    terminalIdRef.current = null;
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
            resizeCleanup = () => window.removeEventListener("resize", onWindowResize);
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
            setTimeout(() => {
                setIsUpdating(false);
                handleRetry();
            }, 65_000);
        } catch {
            setUpdateMsg(t("webTerminal.updateFailed"));
            setIsUpdating(false);
        }
    }, [latestVersion, isUpdating, machineId, handleRetry]);

    const btnBase: React.CSSProperties = {
        padding: "6px 16px",
        borderRadius: 8,
        border: "none",
        fontSize: 13,
        cursor: isUpdating ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        opacity: isUpdating ? 0.6 : 1,
    };

    const showTerminal = state === "connected" || state === "disconnected";
    const showActionBar = state === "disconnected";
    const showFullOverlay = state === "connecting" || state === "error";

    return (
        <View style={{ flex: 1, position: "relative", flexDirection: "column" }}>
            <div
                ref={containerRef}
                style={{
                    flex: 1,
                    minHeight: 0,
                    width: "100%",
                    overflow: "hidden",
                    display: showTerminal ? "block" : "none",
                }}
            />

            {showActionBar && (
                <div style={{
                    height: 48,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    borderTop: `1px solid ${theme.colors.divider}`,
                    backgroundColor: theme.colors.surface,
                    flexShrink: 0,
                }}>
                    {!isUpdating && (
                        <button onClick={handleRetry} style={{ ...btnBase, background: theme.colors.accentBlue ?? "#007aff", color: "#fff" }}>
                            {t("webTerminal.retry")}
                        </button>
                    )}
                    {hasUpdate && latestVersion && !isUpdating && (
                        <button onClick={handleUpdateCli} style={{ ...btnBase, background: "transparent", color: theme.colors.textSecondary, border: `1px solid ${theme.colors.divider}` }}>
                            {t("webTerminal.updateCli", { version: latestVersion })}
                        </button>
                    )}
                    {isUpdating && (
                        <Text style={{ ...Typography.default(), fontSize: 12, color: theme.colors.textSecondary }}>
                            {updateMsg}
                        </Text>
                    )}
                </div>
            )}

            {showFullOverlay && (
                <View style={{
                    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                    justifyContent: "center", alignItems: "center", padding: 32,
                    backgroundColor: theme.colors.groupped?.background, zIndex: 10,
                }}>
                    {state === "connecting" ? (
                        <Text style={{ ...Typography.default(), color: theme.colors.textSecondary }}>
                            {t("webTerminal.connecting")}
                        </Text>
                    ) : (
                        <>
                            <Text style={{
                                ...Typography.default("semiBold"), fontSize: 15,
                                color: theme.colors.textDestructive ?? "#ff3b30",
                                textAlign: "center", marginBottom: 8,
                            }}>
                                {t("webTerminal.connectionFailed")}
                            </Text>
                            {(errorMsg || updateMsg) && (
                                <Text style={{
                                    ...Typography.default(), fontSize: 12,
                                    color: theme.colors.textSecondary,
                                    textAlign: "center", marginBottom: 16,
                                }}>
                                    {updateMsg ?? errorMsg}
                                </Text>
                            )}
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                                {!isUpdating && (
                                    <button onClick={handleRetry} style={{ ...btnBase, background: theme.colors.accentBlue ?? "#007aff", color: "#fff" }}>
                                        {t("webTerminal.retry")}
                                    </button>
                                )}
                                {isMaxReached && !isUpdating && (
                                    <button onClick={handleCloseAllAndRetry} style={{ ...btnBase, background: "transparent", color: theme.colors.textDestructive ?? "#ff3b30", border: `1px solid ${theme.colors.textDestructive ?? "#ff3b30"}` }}>
                                        {t("webTerminal.clearAllSessions")}
                                    </button>
                                )}
                                {hasUpdate && latestVersion && !isUpdating && (
                                    <button onClick={handleUpdateCli} style={{ ...btnBase, background: "transparent", color: theme.colors.textSecondary, border: `1px solid ${theme.colors.divider}` }}>
                                        {t("webTerminal.updateCli", { version: latestVersion })}
                                    </button>
                                )}
                                {!isUpdating && (
                                    <button onClick={onClose} style={{ ...btnBase, background: "transparent", color: theme.colors.textSecondary }}>
                                        {t("webTerminal.closeSession")}
                                    </button>
                                )}
                                {isUpdating && (
                                    <Text style={{ ...Typography.default(), fontSize: 12, color: theme.colors.textSecondary }}>
                                        {updateMsg}
                                    </Text>
                                )}
                            </div>
                        </>
                    )}
                </View>
            )}
        </View>
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
            if (prev.length === 1) return prev; // keep at least one
            const idx = prev.findIndex((t) => t.id === tabId);
            const next = prev.filter((t) => t.id !== tabId);
            if (activeTabId === tabId) {
                // Switch to adjacent tab
                const newActive = next[Math.max(0, idx - 1)];
                setActiveTabId(newActive.id);
            }
            return next;
        });
        setTabStates((prev) => {
            const { [tabId]: _, ...rest } = prev;
            return rest;
        });
    }, [activeTabId]);

    const stateColor = (state: PaneState | undefined, colors: typeof theme.colors): string => {
        if (state === "connected") return "#34c759";
        if (state === "error") return colors.textDestructive ?? "#ff3b30";
        if (state === "disconnected") return colors.textSecondary;
        return colors.textSecondary; // connecting
    };

    const tabBarHeight = 34;

    return (
        <View style={{ flex: 1, flexDirection: "column" }}>
            {/* Tab bar */}
            <div style={{
                height: tabBarHeight,
                display: "flex",
                alignItems: "stretch",
                borderBottom: `1px solid ${theme.colors.divider}`,
                backgroundColor: theme.colors.surfaceHigh,
                overflowX: "auto",
                overflowY: "hidden",
                flexShrink: 0,
            }}>
                {tabs.map((tab) => {
                    const isActive = tab.id === activeTabId;
                    const paneState = tabStates[tab.id];
                    return (
                        <div
                            key={tab.id}
                            onClick={() => setActiveTabId(tab.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                paddingLeft: 10,
                                paddingRight: 6,
                                cursor: "pointer",
                                borderBottom: isActive ? `2px solid ${theme.colors.textLink}` : "2px solid transparent",
                                backgroundColor: isActive ? theme.colors.surface : "transparent",
                                flexShrink: 0,
                                minWidth: 80,
                                maxWidth: 120,
                            }}
                        >
                            {/* State dot */}
                            <div style={{
                                width: 6, height: 6, borderRadius: 3,
                                backgroundColor: stateColor(paneState, theme.colors),
                                flexShrink: 0,
                            }} />
                            <span style={{
                                fontSize: 12,
                                color: isActive ? theme.colors.text : theme.colors.textSecondary,
                                fontFamily: "inherit",
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}>
                                {t("webTerminal.sessionLabel", { n: tab.index })}
                            </span>
                            {tabs.length > 1 && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
                                    style={{
                                        background: "none", border: "none", padding: "2px 2px",
                                        cursor: "pointer", color: theme.colors.textSecondary,
                                        fontSize: 14, lineHeight: 1, borderRadius: 3,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        flexShrink: 0,
                                    }}
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    );
                })}

                {/* New session button */}
                {tabs.length < MAX_SESSIONS && (
                    <button
                        onClick={handleAddTab}
                        title={t("webTerminal.newSession")}
                        style={{
                            background: "none", border: "none",
                            padding: "0 10px",
                            cursor: "pointer",
                            color: theme.colors.textSecondary,
                            fontSize: 18, lineHeight: 1,
                            flexShrink: 0,
                        }}
                    >
                        +
                    </button>
                )}
            </div>

            {/* Panes — all mounted once created, display:none for inactive */}
            <View style={{ flex: 1, position: "relative" }}>
                {tabs.map((tab) => (
                    <View
                        key={tab.id}
                        style={[
                            { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
                            tab.id !== activeTabId && { display: "none" } as any,
                        ]}
                    >
                        <TerminalPane
                            machineId={machineId}
                            cwd={cwd}
                            visible={tab.id === activeTabId}
                            onStateChange={(s) => handleStateChange(tab.id, s)}
                            onClose={() => handleCloseTab(tab.id)}
                            latestVersion={latestVersion}
                            hasUpdate={hasUpdate}
                        />
                    </View>
                ))}
            </View>
        </View>
    );
}

export const WebTerminal = React.memo(WebTerminalComponent);
